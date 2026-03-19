import { invoke } from "@tauri-apps/api/core"

export async function encryptData(text: string, password: string) {
  const enc = new TextEncoder()
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"])
  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  )
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const cipher = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text))
  const bundle = new Uint8Array(salt.length + iv.length + cipher.byteLength)
  bundle.set(salt, 0)
  bundle.set(iv, salt.length)
  bundle.set(new Uint8Array(cipher), salt.length + iv.length)
  let binary = ""
  for (let i = 0; i < bundle.length; i++) binary += String.fromCharCode(bundle[i])
  return btoa(binary)
}

export async function decryptData(base64: string, password: string) {
  const binary = atob(base64)
  const bundle = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bundle[i] = binary.charCodeAt(i)
  const salt = bundle.slice(0, 16)
  const iv = bundle.slice(16, 28)
  const cipher = bundle.slice(28)
  const enc = new TextEncoder()
  const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"])
  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  )
  const plain = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher)
  return new TextDecoder().decode(plain)
}

export async function openExternalLink(url: string) {
  try {
    await invoke("open_external_url", { url })
    return true
  } catch {
    return false
  }
}

export async function copyToClipboard(text: string) {
  try {
    await invoke("copy_text_to_clipboard", { text })
    return true
  } catch {
    return false
  }
}

export function getPathBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop()?.trim() || ""
}
