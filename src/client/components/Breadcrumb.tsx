export default function Breadcrumb({
  path,
  root,
  onNavigate,
}: {
  path: string
  root: string
  onNavigate: (path: string) => void
}) {
  const relativePath = root && path.startsWith(root) ? path.substring(root.length) : path
  const parts = relativePath.split('/').filter(Boolean)

  return (
    <div className="breadcrumb">
      <span className="breadcrumb-item root" onClick={() => onNavigate(root)}>
      🏠︎
      </span>
      {parts.map((part, i) => {
        const fullPath = (root || '') + '/' + parts.slice(0, i + 1).join('/')
        return (
          <span key={fullPath} className="breadcrumb-item">
            <span className="breadcrumb-sep">/</span>
            <span onClick={() => onNavigate(fullPath)}>{part}</span>
          </span>
        )
      })}
    </div>
  )
}
