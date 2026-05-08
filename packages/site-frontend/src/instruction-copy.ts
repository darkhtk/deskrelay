import type { ClaudeInstructionScope } from "./api.ts";

export function instructionScopePlaceholder(scope: ClaudeInstructionScope): string {
  if (scope === "user") {
    return "이 디바이스 사용자 계정의 전역 지침입니다. 저장하면 이 PC에서 실행하는 Claude CLI 세션들이 기본으로 읽습니다.";
  }
  if (scope === "project") {
    return "선택한 작업 폴더의 CLAUDE.md입니다. 이 프로젝트를 여는 모든 세션에 공유할 규칙을 적습니다.";
  }
  if (scope === "projectClaude") {
    return "선택한 작업 폴더의 .claude/CLAUDE.md입니다. Claude 전용 프로젝트 규칙을 코드와 분리해 둘 때 씁니다.";
  }
  if (scope === "local") {
    return "선택한 작업 폴더의 CLAUDE.local.md입니다. 이 PC에만 남길 개인 메모나 로컬 환경 규칙을 적습니다.";
  }
  return "OS 또는 Claude 관리 위치에서 제공되는 읽기 전용 정책 지침입니다. 개인 self-host 설치에서는 비어 있을 수 있습니다.";
}

export function instructionScopeEmptyDescription(scope: ClaudeInstructionScope): string {
  return instructionScopePlaceholder(scope);
}

export function temporaryInstructionPlaceholder(): string {
  return "현재 브라우저에서 보내는 메시지 앞에만 붙는 임시 지침입니다. Claude 지침 파일로 저장되지 않으며 일회성 운영 메모에 적합합니다.";
}
