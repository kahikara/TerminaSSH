export const modalShell: React.CSSProperties = {
width: 860,
height: 580,
maxWidth: "calc(100vw - 40px)",
maxHeight: "calc(100vh - 40px)",
borderRadius: 16,
overflow: "hidden",
display: "flex",
flexDirection: "column",
background: "var(--bg-app)",
border: "1px solid var(--border-subtle)",
boxShadow: "0 18px 60px rgba(0,0,0,0.38)"
}

export const iconButton: React.CSSProperties = {
width: 32,
height: 32,
borderRadius: 9,
display: "inline-flex",
alignItems: "center",
justifyContent: "center",
border: "1px solid var(--border-subtle)",
background: "var(--bg-app)",
color: "var(--text-muted)",
cursor: "pointer",
transition: "background 140ms ease, border-color 140ms ease, color 140ms ease"
}

export const navButtonBase: React.CSSProperties = {
width: "100%",
display: "flex",
alignItems: "center",
gap: 10,
padding: "9px 10px",
borderRadius: 12,
fontSize: 13,
border: "1px solid transparent",
background: "transparent",
cursor: "pointer",
textAlign: "left",
transition: "all 140ms ease"
}

export const cardStyle: React.CSSProperties = {
border: "1px solid var(--border-subtle)",
background: "color-mix(in srgb, var(--bg-sidebar) 82%, var(--bg-app))",
borderRadius: 14,
padding: 14
}

export const inputStyle: React.CSSProperties = {
height: 36,
padding: "0 12px",
borderRadius: 10,
border: "1px solid var(--border-subtle)",
background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
color: "var(--text-main)",
outline: "none",
fontSize: 13
}

export const selectStyle: React.CSSProperties = {
...inputStyle,
width: 156,
cursor: "pointer",
appearance: "none",
WebkitAppearance: "none",
MozAppearance: "none",
background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
backgroundImage:
"linear-gradient(45deg, transparent 50%, var(--text-muted) 50%), linear-gradient(135deg, var(--text-muted) 50%, transparent 50%)",
backgroundPosition: "calc(100% - 18px) calc(50% - 2px), calc(100% - 12px) calc(50% - 2px)",
backgroundSize: "6px 6px, 6px 6px",
backgroundRepeat: "no-repeat",
paddingRight: 32
}

export const uniformSelectStyle: React.CSSProperties = {
...selectStyle
}

export const uniformNumberInputStyle: React.CSSProperties = {
...inputStyle,
width: 156,
textAlign: "center"
}

export const actionBtnStyle: React.CSSProperties = {
minHeight: 36,
padding: "0 12px",
borderRadius: 10,
border: "1px solid var(--border-subtle)",
background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
color: "var(--text-main)",
cursor: "pointer",
fontSize: 13,
fontWeight: 600,
display: "inline-flex",
alignItems: "center",
justifyContent: "center",
gap: 8,
transition: "background 140ms ease, border-color 140ms ease, opacity 140ms ease"
}

export const primaryBtnStyle: React.CSSProperties = {
...actionBtnStyle,
background: "var(--accent)",
color: "black",
border: "1px solid transparent"
}
