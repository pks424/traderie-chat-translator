// 기본 용어 사전: 디아블로2 룬 33종
// content.js(content script)와 popup.js 양쪽에서 로드하는 공용 정의.
//
// - 영문 룬 이름 33종: to를 비워 원문 유지.
//   (수신 번역 시 vex→"성가시게 하다", mal→"잘못된" 같은 일반 단어 오역 방지)
// - 한글 룬 이름(2음절 이상) 16종: 발신 시 영문 룬 이름으로 변환.
//   1음절 이름(엘·탈·랄·솔·돌·헬·코·팔·렘·풀·말·굴·로·자·참·앰·룸)은
//   한국어 조사/일반 단어와 충돌하므로 기본 등록에서 제외 — 필요 시 사용자가 직접 추가.
// - 게임 정식 표기 기준: Shael(샤엘), Zod(조드)

const RUNE_NAMES_EN = [
  'El', 'Eld', 'Tir', 'Nef', 'Eth', 'Ith', 'Tal', 'Ral', 'Ort', 'Thul',
  'Amn', 'Sol', 'Shael', 'Dol', 'Hel', 'Io', 'Lum', 'Ko', 'Fal', 'Lem',
  'Pul', 'Um', 'Mal', 'Ist', 'Gul', 'Vex', 'Ohm', 'Lo', 'Sur', 'Ber',
  'Jah', 'Cham', 'Zod'
];

const RUNE_NAMES_KO = {
  '엘드': 'Eld', '티르': 'Tir', '네프': 'Nef', '에드': 'Eth', '아이드': 'Ith',
  '오르트': 'Ort', '주울': 'Thul', '샤엘': 'Shael', '이오': 'Io', '아이스트': 'Ist',
  '벡스': 'Vex', '오움': 'Ohm', '수르': 'Sur', '베르': 'Ber', '우움': 'Um',
  '조드': 'Zod'
};

const DEFAULT_GLOSSARY = [
  ...RUNE_NAMES_EN.map((n) => ({ from: n, to: '' })),
  ...Object.entries(RUNE_NAMES_KO).map(([ko, en]) => ({ from: ko, to: en }))
];
