/**
 * 루트 페이지. 이 앱은 API 와 관리자 페이지(/admin, Phase 5)를 위한 것이고
 * 사용자에게 보이는 화면은 홈페이지에 임베드되는 위젯이다 (§10).
 */
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>더유제약 챗봇</h1>
      <p>이 주소는 챗봇 API 서버입니다. 챗봇은 홈페이지에 임베드된 위젯으로 이용해주세요.</p>
    </main>
  )
}
