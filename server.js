const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const NEIS_API_KEY = process.env.NEIS_API_KEY || '';
const NEIS_BASE = 'https://open.neis.go.kr/hub';

// Render free tier에서는 재시작 시 메모리 초기화됨. 실서비스는 DB 필요.
const users = new Map();

const allergyMap = {
  '1': '난류', '2': '우유', '3': '메밀', '4': '땅콩', '5': '대두', '6': '밀', '7': '고등어',
  '8': '게', '9': '새우', '10': '돼지고기', '11': '복숭아', '12': '토마토', '13': '아황산류',
  '14': '호두', '15': '닭고기', '16': '쇠고기', '17': '오징어', '18': '조개류', '19': '잣'
};

function normalizeText(s = '') {
  return String(s).trim().replace(/\s+/g, ' ');
}

function getUserId(body) {
  return body?.userRequest?.user?.id || body?.userRequest?.user?.properties?.plusfriendUserKey || 'anonymous';
}

function getUtterance(body) {
  return normalizeText(body?.userRequest?.utterance || '');
}

function reply(text, quickReplies = []) {
  const limited = quickReplies.slice(0, 10).map(q => ({
    label: q.label,
    action: 'message',
    messageText: q.messageText || q.label
  }));
  return {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text } }],
      quickReplies: limited
    }
  };
}

const startButtons = [
  { label: '학교등록', messageText: '학교등록' },
  { label: '학교변경', messageText: '학교변경' },
  { label: '오늘 급식', messageText: '오늘' },
  { label: '내일 급식', messageText: '내일' },
  { label: '이번 주 급식', messageText: '이번주' }
];

const studentButtons = [
  { label: '오늘 급식', messageText: '오늘' },
  { label: '내일 급식', messageText: '내일' },
  { label: '이번 주 급식', messageText: '이번주' },
  { label: '학교변경', messageText: '학교변경' }
];

const parentButtons = [
  { label: '오늘 급식', messageText: '오늘' },
  { label: '내일 급식', messageText: '내일' },
  { label: '이번 주 급식', messageText: '이번주' },
  { label: '저녁추천', messageText: '저녁추천' },
  { label: '장보기', messageText: '장보기' },
  { label: '학교변경', messageText: '학교변경' }
];

function buttonsFor(user) {
  if (!user?.school) return startButtons;
  return user.role === '학부모' ? parentButtons : studentButtons;
}

function ymd(date = new Date()) {
  const local = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10).replace(/-/g, '');
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function dateLabel(yyyymmdd) {
  return `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`;
}

function mondayOf(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun - 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function searchSchool(keyword) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY is missing');
  const url = `${NEIS_BASE}/schoolInfo?KEY=${encodeURIComponent(NEIS_API_KEY)}&Type=json&pIndex=1&pSize=20&SCHUL_NM=${encodeURIComponent(keyword)}`;
  const json = await fetchJson(url);
  const rows = json?.schoolInfo?.[1]?.row || [];
  return rows.map(r => ({
    name: r.SCHUL_NM,
    officeCode: r.ATPT_OFCDC_SC_CODE,
    schoolCode: r.SD_SCHUL_CODE,
    officeName: r.ATPT_OFCDC_SC_NM,
    address: r.ORG_RDNMA || '',
    kind: r.SCHUL_KND_SC_NM || ''
  }));
}

async function fetchMeal(school, date) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY is missing');
  const url = `${NEIS_BASE}/mealServiceDietInfo?KEY=${encodeURIComponent(NEIS_API_KEY)}&Type=json&pIndex=1&pSize=20&ATPT_OFCDC_SC_CODE=${school.officeCode}&SD_SCHUL_CODE=${school.schoolCode}&MLSV_YMD=${date}`;
  const json = await fetchJson(url);
  const rows = json?.mealServiceDietInfo?.[1]?.row || [];
  if (!rows.length) return null;
  const row = rows.find(r => r.MMEAL_SC_NM === '중식') || rows[0];
  const dishes = (row.DDISH_NM || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map(x => x.replace(/\([0-9.]+\)/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const allergyNums = [...new Set(((row.DDISH_NM || '').match(/\(([0-9.]+)\)/g) || [])
    .flatMap(x => x.replace(/[()]/g, '').split('.'))
    .filter(Boolean))];
  return {
    date,
    mealType: row.MMEAL_SC_NM || '급식',
    dishes,
    calories: row.CAL_INFO || '',
    nutrition: row.NTR_INFO || '',
    allergyNums,
    allergyNames: allergyNums.map(n => allergyMap[n]).filter(Boolean)
  };
}

function formatMeal(school, meal, title = '급식') {
  if (!meal) return `🍱 ${school.name} ${title}\n\n해당 날짜의 급식 정보가 없어요.\n휴일, 방학, 재량휴업일이거나 급식 데이터가 아직 등록되지 않았을 수 있어요.`;
  const dishes = meal.dishes.length ? meal.dishes.map(d => `· ${d}`).join('\n') : '메뉴 정보 없음';
  const allergy = meal.allergyNames.length ? meal.allergyNames.join(', ') : '표시된 알레르기 정보 없음';
  const cal = meal.calories ? `\n🔥 ${meal.calories}` : '';
  return `🍱 ${school.name} ${title}\n${dateLabel(meal.date)} ${meal.mealType}\n\n${dishes}${cal}\n⚠️ 알레르기: ${allergy}`;
}

function recommendDinnerFromMeal(meal) {
  const text = (meal?.dishes || []).join(' ');
  if (!meal) {
    return {
      menus: ['계란볶음밥', '두부된장국', '닭가슴살 샐러드'],
      shopping: ['계란', '밥', '두부', '된장', '닭가슴살', '샐러드 채소']
    };
  }
  if (/튀김|돈가스|치킨|탕수|꿔바로우|너겟|강정/.test(text)) {
    return { menus: ['두부샐러드', '계란찜', '맑은 콩나물국'], shopping: ['두부', '샐러드 채소', '계란', '콩나물', '대파'] };
  }
  if (/고기|돼지|돈육|제육|불고기|갈비|닭|소고기|쇠고기/.test(text)) {
    return { menus: ['생선구이', '시금치나물', '두부조림'], shopping: ['생선', '시금치', '두부', '간장', '마늘'] };
  }
  if (/라면|국수|우동|스파게티|파스타|짜장|짬뽕/.test(text)) {
    return { menus: ['잡곡밥', '소고기무국', '오이무침'], shopping: ['잡곡', '소고기', '무', '오이', '고춧가루'] };
  }
  return { menus: ['닭가슴살 채소볶음', '두부된장국', '과일 요거트'], shopping: ['닭가슴살', '양파', '파프리카', '두부', '된장', '요거트', '과일'] };
}

async function todayMealForUser(user, offsetDays = 0) {
  const date = ymd(addDays(new Date(), offsetDays));
  return await fetchMeal(user.school, date);
}

function helpText() {
  return `🍱 급식톡 사용 방법\n\n1. [학교등록] 버튼을 누르거나 아래처럼 입력하세요.\n학교등록 학교명\n예) 학교등록 서울중학교\n\n2. 학교를 선택한 뒤 학생/학부모를 선택하세요.\n\n3. 이후 버튼으로 오늘, 내일, 이번 주 급식을 확인할 수 있어요.\n\n※ 학교명을 잘 모르면 학교명 일부만 입력해도 검색됩니다.`;
}

async function handleText(userId, text) {
  let user = users.get(userId) || {};
  const lower = text.replace(/\s/g, '');

  if (!text || ['처음','시작','설정','도움말','메뉴','사용법'].includes(lower)) {
    return reply(helpText(), startButtons);
  }

  if (['학교변경','학교바꾸기','학교다시등록'].includes(lower)) {
    users.set(userId, { awaitingSchool: true });
    return reply('학교 정보를 초기화했어요.\n\n등록할 학교명을 입력해주세요.\n예) 백양고등학교\n예) 학교등록 동평중학교', [
      { label: '도움말', messageText: '도움말' }
    ]);
  }

  if (lower === '학교등록' || lower === '내학교등록') {
    users.set(userId, { ...user, awaitingSchool: true, pendingSchools: null, pendingSchool: null });
    return reply('등록할 학교명을 입력해주세요.\n\n예) 백양고등학교\n예) 동평중학교\n예) 서울고등학교\n\n학교명 일부만 입력해도 검색할 수 있어요.', [
      { label: '도움말', messageText: '도움말' }
    ]);
  }

  // 학교 선택 버튼 처리: 학교선택|officeCode|schoolCode|encodedName
  if (text.startsWith('학교선택|')) {
    const parts = text.split('|');
    const selected = {
      officeCode: parts[1],
      schoolCode: parts[2],
      name: decodeURIComponent(parts[3] || ''),
      officeName: parts[4] ? decodeURIComponent(parts[4]) : '',
      address: parts[5] ? decodeURIComponent(parts[5]) : ''
    };
    user = { ...user, pendingSchool: selected, school: null, role: null, awaitingRole: true, awaitingSchool: false };
    users.set(userId, user);
    return reply(`🏫 ${selected.name}을(를) 선택했어요.\n\n어떤 사용자로 이용하시나요?`, [
      { label: '학생', messageText: '학생' },
      { label: '학부모', messageText: '학부모' },
      { label: '학교 다시 등록', messageText: '학교등록' }
    ]);
  }

  // 학교등록 학교명 또는 학교 입력 대기 상태일 때 일반 텍스트를 학교명으로 처리
  let schoolKeyword = null;
  if (text.startsWith('학교등록 ')) schoolKeyword = normalizeText(text.replace(/^학교등록\s+/, ''));
  else if (user.awaitingSchool && !['학생','학부모','부모','보호자'].includes(lower)) schoolKeyword = text;

  if (schoolKeyword) {
    const schools = await searchSchool(schoolKeyword);
    if (!schools.length) {
      users.set(userId, { ...user, awaitingSchool: true });
      return reply(`'${schoolKeyword}'로 검색된 학교를 찾지 못했어요.\n\n학교명을 조금 다르게 입력해보세요.\n예) 백양고등학교, 백양고, 동평중학교`, [
        { label: '학교등록', messageText: '학교등록' },
        { label: '도움말', messageText: '도움말' }
      ]);
    }
    if (schools.length === 1) {
      const selected = schools[0];
      user = { ...user, pendingSchool: selected, school: null, role: null, awaitingRole: true, awaitingSchool: false };
      users.set(userId, user);
      return reply(`🏫 ${selected.name}을(를) 찾았어요.\n${selected.officeName}\n${selected.address}\n\n어떤 사용자로 이용하시나요?`, [
        { label: '학생', messageText: '학생' },
        { label: '학부모', messageText: '학부모' },
        { label: '학교 다시 등록', messageText: '학교등록' }
      ]);
    }
    users.set(userId, { ...user, pendingSchools: schools, awaitingSchool: false });
    const buttons = schools.slice(0, 8).map(s => ({
      label: s.name.length > 12 ? s.name.slice(0, 11) + '…' : s.name,
      messageText: `학교선택|${s.officeCode}|${s.schoolCode}|${encodeURIComponent(s.name)}|${encodeURIComponent(s.officeName || '')}|${encodeURIComponent(s.address || '')}`
    }));
    buttons.push({ label: '다시 검색', messageText: '학교등록' });
    const list = schools.slice(0, 8).map((s, i) => `${i+1}. ${s.name} (${s.officeName})`).join('\n');
    return reply(`'${schoolKeyword}' 검색 결과예요.\n아래에서 학교를 선택해주세요.\n\n${list}`, buttons);
  }

  if (['학생','학생입니다','나는학생'].includes(lower) || ['학부모','부모','보호자','나는학부모'].includes(lower)) {
    if (!user.pendingSchool && !user.school) {
      return reply('먼저 학교를 등록해주세요.\n[학교등록] 버튼을 누른 뒤 학교명을 입력하면 됩니다.', startButtons);
    }
    const role = ['학부모','부모','보호자','나는학부모'].includes(lower) ? '학부모' : '학생';
    const school = user.pendingSchool || user.school;
    user = { school, role, awaitingRole: false, awaitingSchool: false };
    users.set(userId, user);
    return reply(`✅ ${school.name} / ${role}(으)로 등록했어요.\n\n이제 버튼을 눌러 급식을 확인해보세요.`, buttonsFor(user));
  }

  if (!user.school && ['오늘','오늘급식','급식','내일','내일급식','이번주','이번주급식','주간급식','저녁추천','장보기'].includes(lower)) {
    return reply('먼저 학교를 등록해주세요.\n\n[학교등록] 버튼을 누른 뒤 학교명을 입력하면 됩니다.', startButtons);
  }

  if (['오늘','오늘급식','오늘뭐나와','급식'].includes(lower)) {
    const meal = await todayMealForUser(user, 0);
    let textOut = formatMeal(user.school, meal, '오늘 급식');
    if (user.role === '학부모') {
      const rec = recommendDinnerFromMeal(meal);
      textOut += `\n\n🍽️ 오늘 저녁 추천\n${rec.menus.map((m,i)=>`${i+1}. ${m}`).join('\n')}\n\n🛒 장보기 목록\n${rec.shopping.join(', ')}`;
    }
    return reply(textOut, buttonsFor(user));
  }

  if (['내일','내일급식','내일뭐나와'].includes(lower)) {
    const meal = await todayMealForUser(user, 1);
    return reply(formatMeal(user.school, meal, '내일 급식'), buttonsFor(user));
  }

  if (['이번주','이번주급식','이번주 급식','주간급식','주간'].includes(text.replace(/\s+/g, ''))) {
    const mon = mondayOf(new Date());
    const days = ['월','화','수','목','금'];
    const lines = [];
    for (let i = 0; i < 5; i++) {
      const date = ymd(addDays(mon, i));
      const meal = await fetchMeal(user.school, date);
      if (!meal) lines.push(`${days[i]}(${dateLabel(date)}): 급식 정보 없음`);
      else lines.push(`${days[i]}(${dateLabel(date)}): ${meal.dishes.slice(0, 5).join(' / ')}`);
    }
    return reply(`📅 ${user.school.name} 이번 주 급식표\n\n${lines.join('\n')}`, buttonsFor(user));
  }

  if (['저녁추천','저녁메뉴','저녁추천해줘','오늘저녁'].includes(lower)) {
    const meal = await todayMealForUser(user, 0);
    const rec = recommendDinnerFromMeal(meal);
    return reply(`🍽️ 오늘 급식을 기준으로 저녁 메뉴를 추천했어요.\n\n${rec.menus.map((m,i)=>`${i+1}. ${m}`).join('\n')}\n\n레시피는 메뉴명을 네이버나 유튜브에 검색하면 쉽게 확인할 수 있어요.`, buttonsFor(user));
  }

  if (['장보기','장보기목록','장보기리스트','재료','필요한재료'].includes(lower)) {
    const meal = await todayMealForUser(user, 0);
    const rec = recommendDinnerFromMeal(meal);
    return reply(`🛒 장보기 목록\n\n${rec.shopping.map(x => `□ ${x}`).join('\n')}\n\n위 목록은 오늘 급식 기준 저녁 추천 메뉴에 필요한 기본 재료예요.`, buttonsFor(user));
  }

  return reply('무엇을 원하는지 잘 모르겠어요.\n아래 버튼을 누르거나 “오늘”, “내일”, “이번주”, “학교등록”이라고 입력해보세요.', buttonsFor(user));
}

app.get('/', (req, res) => {
  res.type('text/plain').send('geupsiktalk kakao skill server final v2 is running. Use POST /skill');
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'geupsiktalk', version: 'final-v2' }));

app.get('/test', async (req, res) => {
  try {
    const schoolKeyword = req.query.school || '백양고등학교';
    const date = req.query.date || ymd();
    const schools = await searchSchool(schoolKeyword);
    const school = schools[0] || null;
    const meal = school ? await fetchMeal(school, date) : null;
    res.json({ ok: true, school, meal });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/skill', async (req, res) => {
  try {
    const userId = getUserId(req.body);
    const text = getUtterance(req.body);
    const result = await handleText(userId, text);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.json(reply(`처리 중 오류가 발생했어요.\n잠시 후 다시 시도해주세요.\n\n오류: ${err.message}`, startButtons));
  }
});

app.listen(PORT, () => {
  console.log(`geupsiktalk final v2 server listening on port ${PORT}`);
});
