export function NotFound({
  title = "We can't find that file",
  body = 'The link may be wrong, or the file may be gone. You can start a new pre-review.',
}: {
  title?: string
  body?: string
}) {
  return (
    <main className="empty-screen">
      <h1>{title}</h1>
      <p>{body}</p>
      <a className="btn btn-primary" href="/">
        Start a pre-review
      </a>
    </main>
  )
}
