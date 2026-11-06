// Stand-in for a screen that hasn't been built yet (Phase 0).
export function Placeholder({ title, design, description }: { title: string; design: string; description: string }) {
  return (
    <section aria-labelledby="placeholder-title">
      <h2 id="placeholder-title">{title}</h2>
      <p>{description}.</p>
      <p style={{ color: 'var(--st-muted)' }}>
        Not built yet. Design: <code>docs/design/{design}</code>
      </p>
    </section>
  );
}
