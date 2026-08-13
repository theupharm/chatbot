/**
 * 카카오맵 링크 (설계문서 §5-2 결과 카드)
 *
 * 카카오맵의 공개 URL 스킴을 쓴다. API 키가 필요 없고, 모바일에서는 설치된 카카오맵 앱이
 * 바로 열린다. 앱이 없으면 웹 지도로 넘어간다.
 *
 * 좌표는 사용자에게 보여줄 목적이 아니라 링크를 만들기 위해서만 쓴다.
 * 서버에 저장하지 않는다 (§13).
 */

const BASE = 'https://map.kakao.com/link'

/** 링크에 들어갈 장소 이름. 쉼표는 스킴의 구분자라 반드시 제거한다 */
function safeName(name: string): string {
  return encodeURIComponent(name.replace(/,/g, ' ').trim())
}

/** 해당 위치를 지도에서 보여준다 */
export function mapViewUrl(name: string, lat: number, lng: number): string {
  return `${BASE}/map/${safeName(name)},${lat},${lng}`
}

/**
 * 길찾기. 출발지는 카카오맵이 사용자의 현재 위치로 잡는다.
 * 위젯이 가진 좌표를 출발지로 넘기지 않는 이유: 주소로 검색한 경우 그 좌표는
 * 사용자의 실제 위치가 아니라 검색한 동네의 좌표이기 때문이다.
 */
export function mapRouteUrl(name: string, lat: number, lng: number): string {
  return `${BASE}/to/${safeName(name)},${lat},${lng}`
}
