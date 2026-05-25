import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;
const NEIS_API_KEY = process.env.NEIS_API_KEY || '';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Very small in-memory storage for Kakao user settings.
// Render Free may sleep/restart, so this can reset. For real service, use a DB later.
const users = new Map();
const pendingSchools = new Map();

const KAKAO_VERSION = '2.0';
const todayKST = () => {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
};
const addDaysKST = (yyyymmdd, days) => {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(y, m, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10).replace(/-/g, '');
};
const weekdayKST = (yyyymmdd) => {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(y, m, d));
  return date.getUTCDay();
};
const mondayOfWeek = (yyyymmdd) => {
  const day = weekdayKST(yyyymmdd);
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysKST(yyyymmdd, diff);
};

function kakaoText(text, quickReplies = []) {
  return {
    version: KAKAO_VERSION,
    template: {
      outputs: [{ simpleText: { text: text.slice(0, 1000) } }],
      quickReplies
    }
  };
}

function getUserId(body) {
  return body?.userRequest?.user?.id || body?.userRequest?.user?.properties?.plusfriendUserKey || 'anonymous';
}
function getUtterance(body) {
  return (body?.userRequest?.utterance || '').trim();
}
function cleanMealName(raw = '') {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\([0-9.]+\)/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim();
}
function makeMealSummary(items) {
  if (!items || items.length === 0) return '급식 정보가 없습니다.';
  return items.map(item => cleanMealName(item.DDISH_NM)).join('\n');
}

async function neisFetch(path, params) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY 환경변수가 없습니다. Render Environment에 NEIS_API_KEY를 등록하세요.');
  const url = new URL(`https://open.neis.go.kr/hub/${path}`);
  url.searchParams.set('KEY', NEIS_API_KEY);
  url.searchParams.set('Type', 'json');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NEIS API HTTP ${res.status}`);
  const data = await res.json();
  return data;
}

async function searchSchool(name) {
  const data = await neisFetch('schoolInfo', { pIndex: '1', pSize: '5', SCHUL_NM: name });
  const rows = data?.schoolInfo?.[1]?.row || [];
  return rows.map(s => ({
    officeCode: s.ATPT_OFCDC_SC_CODE,
    schoolCode: s.SD_SCHUL_CODE,
    schoolName: s.SCHUL_NM,
    region: s.LCTN_SC_NM || s.ATPT_OFCDC_SC_NM || '',
    address: s.ORG_RDNMA || ''
  }));
}

async function getMeal(school, date) {
  const data = await neisFetch('mealServiceDietInfo', {
    pIndex: '1',
    pSize: '10',
    ATPT_OFCDC_SC_CODE: school.officeCode,
    SD_SCHUL_CODE: school.schoolCode,
    MLSV_YMD: date
  });
  return data?.mealServiceDietInfo?.[1]?.row || [];
}

function recommendDinner(mealText) {
  const heavy = /(튀김|돈까스|돈가스|탕수|치킨|삼겹|불고기|제육|햄|소시지|피자|버거)/.test(mealText);
  const noodle = /(라면|국수|우동|짜장|짬뽕|스파게티|파스타)/.test(mealText);
  if (heavy) {
    return {
      reason: '점심에 기름지거나 고기 중심 메뉴가 있어요. 저녁은 조금 가볍게 추천합니다.',
      menus: ['두부샐러드', '계란찜과 나물반찬', '닭가슴살 채소볶음'],
      shopping: ['두부', '계란', '시금치 또는 콩나물', '닭가슴살', '양상추', '오이']
    };
  }
  if (noodle) {
    return {
      reason: '점심에 면류가 있어요. 저녁은 밥과 단백질, 채소를 균형 있게 추천합니다.',
      menus: ['소고기무국', '두부부침', '채소비빔밥'],
      shopping: ['소고기', '무', '두부', '계란', '상추', '당근']
    };
  }
  return {
    reason: '점심과 겹치지 않게 무난하고 부담 없는 저녁 메뉴를 추천합니다.',
    menus: ['닭가슴살 채소볶음', '두부된장국', '계란말이와 샐러드'],
    shopping: ['닭가슴살', '양파', '파프리카', '두부', '된장', '계란', '샐러드 채소']
  };
}

function helpText() {
  return `🍱 급식톡 사용 방법\n\n1. 학교등록 백양고등학교\n2. 학생 또는 학부모 선택\n3. 오늘 / 내일 / 이번주 입력\n\n예시\n학교등록 백양고등학교\n오늘\n내일\n이번주\n\n학교를 바꾸려면 학교변경을 입력하세요.`;
}

app.get('/', (req, res) => {
  res.type('text/plain').send('geupsiktalk kakao skill server is running. Use POST /skill');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'geupsiktalk', hasNeisKey: Boolean(NEIS_API_KEY) });
});

app.post('/skill', async (req, res) => {
  try {
    const userId = getUserId(req.body);
    const utterance = getUtterance(req.body);
    const user = users.get(userId) || {};

    if (!utterance || /^(시작|처음|도움말|메뉴|설정)$/i.test(utterance)) {
      return res.json(kakaoText(helpText(), [
        { label: '오늘', action: 'message', messageText: '오늘' },
        { label: '이번주', action: 'message', messageText: '이번주' },
        { label: '학교등록', action: 'message', messageText: '학교등록 ' }
      ]));
    }

    if (/^학교변경$|^학교 변경$/.test(utterance)) {
      users.delete(userId);
      pendingSchools.delete(userId);
      return res.json(kakaoText('학교 정보를 초기화했어요.\n새 학교를 아래처럼 입력해주세요.\n\n예: 학교등록 백양고등학교'));
    }

    if (utterance.startsWith('학교등록') || utterance.startsWith('학교 등록')) {
      const name = utterance.replace(/^학교\s*등록/, '').replace(/^학교등록/, '').trim();
      if (!name) return res.json(kakaoText('학교명을 함께 입력해주세요.\n예: 학교등록 백양고등학교'));
      const schools = await searchSchool(name);
      if (schools.length === 0) return res.json(kakaoText(`'${name}' 검색 결과가 없어요.\n학교명을 정확히 입력해주세요.`));
      pendingSchools.set(userId, schools[0]);
      const list = schools.map((s, i) => `${i + 1}. ${s.region} ${s.schoolName}`).join('\n');
      return res.json(kakaoText(`아래 학교로 등록할게요.\n\n${list}\n\n학생이면 '학생', 학부모이면 '학부모'라고 입력해주세요.`));
    }

    if (/^(학생|학부모)$/.test(utterance)) {
      const pending = pendingSchools.get(userId);
      if (!pending) return res.json(kakaoText('먼저 학교를 등록해주세요.\n예: 학교등록 백양고등학교'));
      users.set(userId, { ...pending, userType: utterance });
      pendingSchools.delete(userId);
      return res.json(kakaoText(`${pending.schoolName} / ${utterance}으로 등록했어요.\n\n이제 '오늘', '내일', '이번주'를 입력하면 급식을 볼 수 있어요.`, [
        { label: '오늘', action: 'message', messageText: '오늘' },
        { label: '내일', action: 'message', messageText: '내일' },
        { label: '이번주', action: 'message', messageText: '이번주' }
      ]));
    }

    if (!user.schoolCode) {
      return res.json(kakaoText('아직 학교가 등록되지 않았어요.\n아래처럼 먼저 입력해주세요.\n\n예: 학교등록 백양고등학교'));
    }

    if (/^(오늘|오늘급식|급식)$/.test(utterance) || /^(내일|내일급식)$/.test(utterance)) {
      const base = todayKST();
      const date = utterance.startsWith('내일') ? addDaysKST(base, 1) : base;
      const rows = await getMeal(user, date);
      const mealText = makeMealSummary(rows);
      const dateLabel = `${date.slice(4, 6)}/${date.slice(6, 8)}`;
      let reply = `🍱 ${user.schoolName} ${dateLabel} 급식\n\n${mealText}`;
      if (rows[0]?.CAL_INFO) reply += `\n\n🔥 ${rows[0].CAL_INFO}`;
      if (user.userType === '학부모') {
        const rec = recommendDinner(mealText);
        reply += `\n\n🍽️ 저녁 추천\n${rec.reason}\n- ${rec.menus.join('\n- ')}\n\n🛒 장보기\n${rec.shopping.join(', ')}`;
      }
      return res.json(kakaoText(reply, [
        { label: '내일', action: 'message', messageText: '내일' },
        { label: '이번주', action: 'message', messageText: '이번주' }
      ]));
    }

    if (/^(이번주|이번 주|주간급식|이번주급식)$/.test(utterance)) {
      const monday = mondayOfWeek(todayKST());
      const names = ['월', '화', '수', '목', '금'];
      const parts = [];
      for (let i = 0; i < 5; i++) {
        const date = addDaysKST(monday, i);
        const rows = await getMeal(user, date);
        const meal = makeMealSummary(rows).split('\n').slice(0, 6).join(' / ');
        parts.push(`${names[i]}(${date.slice(4, 6)}/${date.slice(6, 8)}): ${meal}`);
      }
      return res.json(kakaoText(`📅 ${user.schoolName} 이번 주 급식표\n\n${parts.join('\n\n')}`));
    }

    if (/^(저녁추천|장보기)$/.test(utterance)) {
      const rows = await getMeal(user, todayKST());
      const mealText = makeMealSummary(rows);
      const rec = recommendDinner(mealText);
      return res.json(kakaoText(`🍽️ 오늘 급식 기준 저녁 추천\n\n${rec.reason}\n\n- ${rec.menus.join('\n- ')}\n\n🛒 장보기 목록\n${rec.shopping.join(', ')}`));
    }

    return res.json(kakaoText(helpText()));
  } catch (err) {
    console.error('Skill error:', err);
    return res.json(kakaoText(`일시적인 오류가 발생했어요.\n\n오류: ${err.message}\n\n잠시 후 다시 시도해주세요.`));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`geupsiktalk server listening on port ${PORT}`);
});
