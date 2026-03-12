mkdir -p backups

ts="$(date +%F_%H-%M-%S)"
backup_file="backups/termina_ssh_snapshot_${ts}.tar.gz"

echo "===== BACKUP ERSTELLEN ====="
tar \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./build' \
  --exclude='./src-tauri/target' \
  --exclude='./.git' \
  --exclude='./backups' \
  --exclude='./termina-ssh-snapshot*.tar.gz' \
  --exclude='./termina_ssh_snapshot*.tar.gz' \
  -czf "$backup_file" .

echo "Backup erstellt: $backup_file"

echo
echo "===== ALTE SNAPSHOTS NACH backups VERSCHIEBEN ====="
find . -maxdepth 1 -type f \( -name 'termina-ssh-snapshot*.tar.gz' -o -name 'termina_ssh_snapshot*.tar.gz' \) \
  -print -exec mv -n {} backups/ \; 2>/dev/null || true

echo
echo "===== BAK DATEIEN ANZEIGEN ====="
find . \
  -path './node_modules' -prune -o \
  -path './dist' -prune -o \
  -path './build' -prune -o \
  -path './src-tauri/target' -prune -o \
  -type f \( -name '*.bak' -o -name '*.bak.*' \) -print

echo
echo "===== BAK DATEIEN LÖSCHEN ====="
find . \
  -path './node_modules' -prune -o \
  -path './dist' -prune -o \
  -path './build' -prune -o \
  -path './src-tauri/target' -prune -o \
  -type f \( -name '*.bak' -o -name '*.bak.*' \) -delete

echo
echo "===== BACKUPS ====="
ls -lh backups

echo
echo "===== FERTIG ====="
