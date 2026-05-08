# 버전 호환성

DeskRelay self-host는 한 저장소에서 server와 connector를 같이 실행한다. 새 기능이 추가되면 브라우저 UI만 새로고침해서는 충분하지 않다.

## 맞춰야 하는 실행 단위

| 실행 단위 | 역할 | 확인 위치 |
|---|---|---|
| frontend | 브라우저 UI와 호출 경로 | 서버 URL |
| site backend | `/api/devices/:id/*` 프록시 API | `/healthz` |
| connector daemon | 각 PC에서 실제 Claude Code/파일/세션/지침 API 처리 | `/status` |

## 규칙

- server와 connector daemon은 같은 git commit이면 정상이다.
- 둘 중 하나라도 다른 commit이면 새 API에서 404나 오래된 동작이 날 수 있다.
- dirty 상태도 버전 불일치로 취급한다. 같은 commit이라도 한쪽에 수정된 파일이 있으면 실제 실행 코드가 다를 수 있다.

## 사용자에게 보여줄 것

연결 진단 탭은 server build와 connector build를 함께 표시한다.

- 일치: 같은 commit과 같은 dirty 상태
- 불일치: server와 connector 중 하나가 오래됨
- 확인 필요: git 정보가 없거나 패키지 버전만 있는 설치

## 복구

1. server PC에서 최신 코드로 서버를 재시작한다.
2. 다른 PC connector는 등록 명령을 다시 실행하거나 connector를 재시작한다.
3. 연결 진단 탭의 버전 행이 일치로 바뀌는지 확인한다.
