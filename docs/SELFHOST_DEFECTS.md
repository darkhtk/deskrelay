# Self-Host Test Defects

이 문서는 self-host 설치/등록 테스트를 강화하면서 실제로 발견한 결함과 조치 내용을 기록한다.

## 2026-05-08 발견 사항

### 1. `/fs/list` 테스트가 파일을 기대함

**분류:** 테스트 설계 오류  
**영향:** 가상 E2E가 제품 동작과 다른 기대값으로 실패했다.  
**증상:** 테스트 fixture에 만든 `hello.txt`가 `/fs/list` 결과에 있어야 한다고 검증했다.  
**원인:** `/fs/list`는 cwd picker용 API라 파일이 아니라 디렉터리만 반환한다.  
**조치:** fixture를 `hello-dir/hello.txt`로 바꾸고, 목록에는 `hello-dir`가 보이는지 확인하도록 수정했다.  
**상태:** 수정 완료.

### 2. advertised endpoint 실패 메시지가 자기모순을 냄

**분류:** 제품 UX 결함  
**영향:** 원격 PC 등록 실패 시 사용자가 실제 원인을 알기 어렵다.  
**증상:** connector가 외부 advertise 주소로 닿지 않는 상황에서 다음처럼 자기모순적인 메시지가 나왔다.

```text
connector is still bound to 127.0.0.1:PORT; expected 127.0.0.1:PORT
```

**원인:** daemon state의 listen host가 local-only인지 확인한 뒤, 실제 기대 listen host와 같은지 비교하지 않고 `still bound` 오류를 냈다.  
**조치:** 실제 state host와 expected listen host가 다를 때만 `still bound` 메시지를 내도록 수정했다. 같은 listen host인데 advertised endpoint만 닿지 않으면 `cannot reach connector at ...` 오류를 낸다.  
**상태:** 수정 완료.

### 3. `self-register.test.ts`가 실제 PC의 `18091` 포트 상태에 의존함

**분류:** 테스트 격리 결함  
**영향:** 테스트가 사용자 PC의 실제 connector 상태에 영향을 받아 타임아웃이 나거나 실제 프로세스에 간섭할 수 있다.  
**증상:** 기존 unit test 중 “stale local connector stop” 케이스가 5초 timeout에 걸렸다.  
**원인:** fetch는 mock을 쓰면서도 port free check와 stop path는 기본 포트 `18091`의 실제 환경을 보았다.  
**조치:** 테스트 전용 포트를 사용하고 `stopPortOwner`를 주입해 실제 사용자 환경과 분리했다.  
**상태:** 수정 완료.

### 4. Tailscale 없음 테스트는 현재 머신에서 재현 불가

**분류:** 테스트 환경 한계  
**영향:** “Tailscale URL인데 대상 PC에 Tailscale IP가 없음” 케이스를 이 머신에서는 자동 검증할 수 없다.  
**증상:** 테스트 머신에 실제 Tailscale IPv4가 있어 해당 negative path로 진입하지 않는다.  
**조치:** Tailscale IPv4가 있는 환경에서는 해당 케이스를 skip하도록 했다.  
**상태:** 한계 기록. Tailscale 없는 Windows VM에서 별도 검증 필요.

## 현재 통과한 검증

- `bun run test:selfhost-failures`
- `bun run test:selfhost-virtual`
- `bun --filter @deskrelay/pc-connector-daemon test self-register.test.ts`
- `bun --filter @deskrelay/site-backend test`
- `bun --filter @deskrelay/pc-connector-daemon typecheck`
- `bun --filter @deskrelay/site-backend typecheck`
- Biome check for changed docs/scripts/source files
