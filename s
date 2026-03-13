python - <<'PY'
from pathlib import Path

path = Path("src/App.tsx")
text = path.read_text()

repls = [
    (
        'className="w-[70px] h-[70px] object-contain mr-0.5 shrink-0"',
        'className="w-[56px] h-[56px] object-contain mr-2 shrink-0"'
    ),
    (
        'className="flex-1 flex items-center self-stretch"',
        'className="flex-1 flex items-center justify-center self-stretch min-w-0"'
    ),
    (
        'className="font-bold tracking-wide text-[14px] text-[var(--text-main)] leading-none"',
        'className="font-bold tracking-wide text-[14px] text-[var(--text-main)] leading-none text-center"'
    ),
    (
        'className="ui-icon-btn"><Home size={18}/></button>',
        'className="ui-icon-btn shrink-0"><Home size={18}/></button>'
    ),
]

done = 0
for old, new in repls:
    if old in text:
        text = text.replace(old, new, 1)
        done += 1

if done == 0:
    raise SystemExit("no sidebar header parts matched")

path.write_text(text)
print("patched src/App.tsx")
PY
