use aes_gcm::aead::rand_core::RngCore;
use tauri::State;
use std::path::Path;

use crate::{
    count_legacy_secret_entries, current_export_timestamp, decode_vault_with_recovery,
    decode_vault_with_secret, delete_legacy_master_key, finalize_legacy_master_key_cleanup_with_dek,
    generate_recovery_key, init_vault_db, load_vault_status, normalize_vault_unlock_mode,
    open_db, open_vault_db, require_runtime_vault_dek, vault_encrypt_combined,
    DEFAULT_VAULT_UNLOCK_MODE, EnableVaultProtectionResult, VAULT_KEY_LEN, VAULT_SALT_LEN,
    VAULT_SCHEMA_VERSION, VAULT_VALIDATION_TEXT, VaultState, VaultStatus,
};

#[tauri::command]
pub(crate) fn get_vault_status(vault_state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    crate::ensure_vault_runtime_ready(&vault_state)?;
    let conn = open_vault_db()?;
    let runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    load_vault_status(&conn, &runtime)
}

#[tauri::command]
pub(crate) fn enable_vault_protection(
    master_password: String,
    unlock_mode: String,
    vault_state: State<'_, VaultState>,
) -> Result<EnableVaultProtectionResult, String> {
    if master_password.trim().is_empty() {
        return Err("Master password is empty".to_string());
    }

    init_vault_db()?;
    let conn_db = open_db()?;
    let migrated_secret_entries = count_legacy_secret_entries(&conn_db)?;
    crate::ensure_vault_runtime_ready(&vault_state)?;
    let vault_conn = open_vault_db()?;

    let existing: (i32, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, local_dek FROM meta WHERE id = 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    if existing.0 != 0 {
        return Err("Vault protection is already enabled".to_string());
    }

    let normalized_unlock_mode = normalize_vault_unlock_mode(&unlock_mode);
    let dek = if existing.1.len() == VAULT_KEY_LEN {
        existing.1.clone()
    } else {
        require_runtime_vault_dek(&vault_conn, &vault_state)?
    };

    let mut salt = [0u8; VAULT_SALT_LEN];
    aes_gcm::aead::OsRng.fill_bytes(&mut salt);

    let recovery_key = generate_recovery_key();
    let master_key = decode_vault_with_secret::derive_only(&master_password, &salt)?;
    let recovery_wrap_key = decode_vault_with_secret::derive_only(&recovery_key, &salt)?;

    let encrypted_dek = vault_encrypt_combined(&master_key, &dek)?;
    let recovery_encrypted_dek = vault_encrypt_combined(&recovery_wrap_key, &dek)?;
    let kek_validation = vault_encrypt_combined(&dek, VAULT_VALIDATION_TEXT)?;

    let now = current_export_timestamp();
    vault_conn
        .execute(
            "UPDATE meta
             SET schema_version = ?1,
                 is_protected = 1,
                 unlock_mode = ?2,
                 salt = ?3,
                 encrypted_dek = ?4,
                 local_dek = X'',
                 recovery_encrypted_dek = ?5,
                 kek_validation = ?6,
                 updated_at = ?7
             WHERE id = 1",
            (
                &VAULT_SCHEMA_VERSION,
                &normalized_unlock_mode,
                &salt.to_vec(),
                &encrypted_dek,
                &recovery_encrypted_dek,
                &kek_validation,
                &now,
            ),
        )
        .map_err(|e| e.to_string())?;

    if Path::new(&crate::get_key_path()).exists() {
        delete_legacy_master_key()?;
    }

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = normalized_unlock_mode;
    runtime.session_dek = Some(dek);

    Ok(EnableVaultProtectionResult {
        recovery_key,
        migrated_secret_entries,
    })
}

#[tauri::command]
pub(crate) fn update_vault_unlock_mode(
    unlock_mode: String,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, String> {
    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let normalized_unlock_mode = normalize_vault_unlock_mode(&unlock_mode);
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET unlock_mode = ?1,
                 updated_at = ?2
             WHERE id = 1",
            (&normalized_unlock_mode, &now),
        )
        .map_err(|e| e.to_string())?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.unlock_mode = normalized_unlock_mode;

    load_vault_status(&vault_conn, &runtime)
}

#[tauri::command]
pub(crate) fn regenerate_vault_recovery_key(
    vault_state: State<'_, VaultState>,
) -> Result<EnableVaultProtectionResult, String> {
    init_vault_db()?;
    let vault_conn = open_vault_db()?;

    let row: (i32, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, salt
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    if row.1.len() < VAULT_SALT_LEN {
        return Err("Vault salt is invalid".to_string());
    }

    let dek = require_runtime_vault_dek(&vault_conn, &vault_state)?;
    let new_recovery_key = generate_recovery_key();
    let recovery_wrap_key = decode_vault_with_secret::derive_only(&new_recovery_key, &row.1)?;
    let recovery_encrypted_dek = vault_encrypt_combined(&recovery_wrap_key, &dek)?;
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET recovery_encrypted_dek = ?1,
                 updated_at = ?2
             WHERE id = 1",
            (&recovery_encrypted_dek, &now),
        )
        .map_err(|e| e.to_string())?;

    Ok(EnableVaultProtectionResult {
        recovery_key: new_recovery_key,
        migrated_secret_entries: 0,
    })
}

#[tauri::command]
pub(crate) fn disable_vault_protection(vault_state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let conn_db = open_db()?;
    let dek = require_runtime_vault_dek(&vault_conn, &vault_state)?;

    let _ = finalize_legacy_master_key_cleanup_with_dek(&conn_db, &vault_conn, &dek)?;

    let now = current_export_timestamp();
    let unlock_mode = DEFAULT_VAULT_UNLOCK_MODE.to_string();

    vault_conn
        .execute(
            "UPDATE meta
             SET is_protected = 0,
                 unlock_mode = ?1,
                 salt = X'',
                 encrypted_dek = X'',
                 local_dek = ?2,
                 recovery_encrypted_dek = X'',
                 kek_validation = X'',
                 updated_at = ?3
             WHERE id = 1",
            (&unlock_mode, &dek, &now),
        )
        .map_err(|e| e.to_string())?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = unlock_mode;
    runtime.session_dek = Some(dek);

    load_vault_status(&vault_conn, &runtime)
}

#[tauri::command]
pub(crate) fn validate_vault_recovery_key(
    recovery_key: String,
) -> Result<(), String> {
    let normalized_recovery_key = recovery_key.trim().to_ascii_uppercase();
    if normalized_recovery_key.is_empty() {
        return Err("Recovery key is empty".to_string());
    }

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let row: (i32, Vec<u8>, Vec<u8>, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, salt, recovery_encrypted_dek, kek_validation
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    if row.2.is_empty() {
        return Err("Recovery data is missing".to_string());
    }

    let (dek, validation) = decode_vault_with_recovery(&normalized_recovery_key, &row.1, &row.2, &row.3)?;

    if validation.as_slice() != VAULT_VALIDATION_TEXT {
        return Err("Recovery key is invalid".to_string());
    }

    let _ = dek;
    Ok(())
}

#[tauri::command]
pub(crate) fn reset_vault_master_password_with_recovery_key(
    recovery_key: String,
    new_master_password: String,
    vault_state: State<'_, VaultState>,
) -> Result<EnableVaultProtectionResult, String> {
    let normalized_recovery_key = recovery_key.trim().to_ascii_uppercase();
    if normalized_recovery_key.is_empty() {
        return Err("Recovery key is empty".to_string());
    }

    if new_master_password.trim().is_empty() {
        return Err("Master password is empty".to_string());
    }

    if new_master_password.chars().count() < 6 {
        return Err("Master password must be at least 6 characters".to_string());
    }

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let row: (i32, String, Vec<u8>, Vec<u8>, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, unlock_mode, salt, recovery_encrypted_dek, kek_validation
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    if row.3.is_empty() {
        return Err("Recovery data is missing".to_string());
    }

    let (dek, validation) = decode_vault_with_recovery(&normalized_recovery_key, &row.2, &row.3, &row.4)?;
    if validation.as_slice() != VAULT_VALIDATION_TEXT {
        return Err("Recovery key is invalid".to_string());
    }

    let mut new_salt = [0u8; VAULT_SALT_LEN];
    aes_gcm::aead::OsRng.fill_bytes(&mut new_salt);

    let new_recovery_key = generate_recovery_key();
    let new_master_key = decode_vault_with_secret::derive_only(&new_master_password, &new_salt)?;
    let new_recovery_wrap_key = decode_vault_with_secret::derive_only(&new_recovery_key, &new_salt)?;

    let encrypted_dek = vault_encrypt_combined(&new_master_key, &dek)?;
    let recovery_encrypted_dek = vault_encrypt_combined(&new_recovery_wrap_key, &dek)?;
    let kek_validation = vault_encrypt_combined(&dek, VAULT_VALIDATION_TEXT)?;

    let normalized_unlock_mode = normalize_vault_unlock_mode(&row.1);
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET is_protected = 1,
                 unlock_mode = ?1,
                 salt = ?2,
                 encrypted_dek = ?3,
                 local_dek = X'',
                 recovery_encrypted_dek = ?4,
                 kek_validation = ?5,
                 updated_at = ?6
             WHERE id = 1",
            (
                &normalized_unlock_mode,
                &new_salt.to_vec(),
                &encrypted_dek,
                &recovery_encrypted_dek,
                &kek_validation,
                &now,
            ),
        )
        .map_err(|e| e.to_string())?;

    let conn_db = open_db()?;
    let migrated_secret_entries =
        finalize_legacy_master_key_cleanup_with_dek(&conn_db, &vault_conn, &dek)?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = normalized_unlock_mode;
    runtime.session_dek = Some(dek);

    Ok(EnableVaultProtectionResult {
        recovery_key: new_recovery_key,
        migrated_secret_entries,
    })
}

#[tauri::command]
pub(crate) fn change_vault_master_password(
    current_master_password: String,
    new_master_password: String,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, String> {
    if current_master_password.trim().is_empty() {
        return Err("Current master password is empty".to_string());
    }

    if new_master_password.trim().is_empty() {
        return Err("New master password is empty".to_string());
    }

    if new_master_password.chars().count() < 6 {
        return Err("New master password must be at least 6 characters".to_string());
    }

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let row: (i32, String, Vec<u8>, Vec<u8>, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, unlock_mode, salt, encrypted_dek, kek_validation
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    let (dek, validation) = decode_vault_with_secret(&current_master_password, &row.2, &row.3, &row.4)?;
    if validation.as_slice() != VAULT_VALIDATION_TEXT {
        return Err("Current master password is invalid".to_string());
    }

    let new_master_key = decode_vault_with_secret::derive_only(&new_master_password, &row.2)?;
    let encrypted_dek = vault_encrypt_combined(&new_master_key, &dek)?;
    let normalized_unlock_mode = normalize_vault_unlock_mode(&row.1);
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET encrypted_dek = ?1,
                 updated_at = ?2
             WHERE id = 1",
            (&encrypted_dek, &now),
        )
        .map_err(|e| e.to_string())?;

    let conn_db = open_db()?;
    let _ = finalize_legacy_master_key_cleanup_with_dek(&conn_db, &vault_conn, &dek)?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = normalized_unlock_mode;
    runtime.session_dek = Some(dek);

    load_vault_status(&vault_conn, &runtime)
}

#[tauri::command]
pub(crate) fn unlock_vault(
    master_password: String,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, String> {
    if master_password.trim().is_empty() {
        return Err("Master password is empty".to_string());
    }

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let row: (i32, String, Vec<u8>, Vec<u8>, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, unlock_mode, salt, encrypted_dek, kek_validation
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    let (dek, validation) = decode_vault_with_secret(&master_password, &row.2, &row.3, &row.4)?;
    if validation.as_slice() != VAULT_VALIDATION_TEXT {
        return Err("Master password is invalid".to_string());
    }

    let conn_db = open_db()?;
    let _ = finalize_legacy_master_key_cleanup_with_dek(&conn_db, &vault_conn, &dek)?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = normalize_vault_unlock_mode(&row.1);
    runtime.session_dek = Some(dek);

    load_vault_status(&vault_conn, &runtime)
}

#[tauri::command]
pub(crate) fn lock_vault(vault_state: State<'_, VaultState>) -> Result<(), String> {
    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = false;
    runtime.session_dek = None;
    Ok(())
}
