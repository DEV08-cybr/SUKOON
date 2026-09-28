export default function HomePage() {
  return (
    <main aria-label="SUKOON music player">
      <iframe
        className="player-frame"
        src="/player.html"
        title="SUKOON ambient music player"
        allow="autoplay; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
      />
    </main>
  );
}
