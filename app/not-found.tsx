export const dynamic = "force-dynamic"

export default function NotFound() {
  return (
    <div style={{ textAlign: "center", padding: "4rem", fontFamily: "sans-serif" }}>
      <h1 style={{ color: "#012169", fontSize: "4rem" }}>404</h1>
      <p style={{ color: "#63666A" }}>Page not found</p>
      <a href="/" style={{ color: "#418FDE", textDecoration: "none" }}>← Go home</a>
    </div>
  )
}
