const express = require('express');
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;
const NEIS_API_KEY = process.env.NEIS_API_KEY || '';

function kakaoText(text) {
  return {
    version: '2.0',
    template: {
      outputs: [
        {
          simpleText: {
            text: String(text).slice(0, 990)
          }
        }
      ]
    }
  };
}

function getUserText(req) {
  return (
    req.body?.userRequest?.utterance ||
    req.body?.action?.params?.utterance ||
    req.body?.utterance ||
    ''
  ).trim();
}

app.get('/', (req, res) => {
  res.type('text/plain').send('geupsiktalk kakao skill server is running. Use POST /skill');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), hasNeisKey: Boolean(NEIS_API_KEY) });
});

app.post('/skill', async (req, res) => {
  try {
    const utterance = getUserText(req);

    if (!NEIS_API_KEY) {
      return res.json(kakaoText('서버는 켜져 있지만 NEIS_API_KEY 환경변수가 아직 설정되지 않았습니다. Render Environment Variables에 NEIS_API_KEY를 추가해주세요.'));
    }

    if (!utterance || utterance === '도움말' || utterance === '시작' || utterance === '설정') {
      return res.json(kakaoText('🍱 급식톡 사용 방법\n\n1. 학교등록 백양고등학교\n2. 학생 또는 학부모 선택\n3. 오늘 / 내일 / 이번주 입력\n\n현재 서버 연결 테스트가 정상 작동 중입니다.'));
    }

    if (utterance.startsWith('학교등록')) {
      const schoolName = utterance.replace('학교등록', '').trim();
      if (!schoolName) {
        return res.json(kakaoText('학교명을 함께 입력해주세요.\n예: 학교등록 백양고등학교'));
      }
      return res.json(kakaoText(`🔎 ${schoolName} 학교 등록 요청을 받았습니다.\n\n다음 단계에서 나이스 학교 검색 기능과 연결됩니다.\n지금은 서버 연결 테스트 단계입니다.`));
    }

    if (['학생', '학부모'].includes(utterance)) {
      return res.json(kakaoText(`${utterance} 유형으로 선택되었습니다.\n\n다음 단계에서 사용자별 저장 기능을 연결합니다.`));
    }

    if (['오늘', '오늘급식', '급식'].includes(utterance)) {
      return res.json(kakaoText('🍱 오늘 급식 조회 테스트 성공\n\n서버가 정상적으로 응답하고 있습니다.\n다음 단계에서 실제 나이스 급식 API 조회를 연결합니다.'));
    }

    if (['내일', '내일급식'].includes(utterance)) {
      return res.json(kakaoText('📅 내일 급식 조회 테스트 성공\n\n서버가 정상적으로 응답하고 있습니다.'));
    }

    if (['이번주', '이번 주', '주간급식', '이번주급식'].includes(utterance)) {
      return res.json(kakaoText('📅 이번 주 급식표 조회 테스트 성공\n\n서버가 정상적으로 응답하고 있습니다.'));
    }

    return res.json(kakaoText(`입력한 말: ${utterance}\n\n사용 가능한 명령어는 학교등록, 오늘, 내일, 이번주, 설정입니다.`));
  } catch (error) {
    console.error('Skill error:', error);
    return res.json(kakaoText('서버 처리 중 오류가 발생했습니다. Render Logs를 확인해주세요.'));
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json(kakaoText('서버 오류가 발생했습니다.'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`geupsiktalk server listening on port ${PORT}`);
});
