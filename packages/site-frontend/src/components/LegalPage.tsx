import { type Component, Show } from "solid-js";

export type LegalPageKind = "privacy" | "terms";

type LegalPageProps = {
  kind: LegalPageKind;
};

export const LegalPage: Component<LegalPageProps> = (props) => {
  return (
    <article class="legal-page">
      <a class="legal-back" href="/">
        Back to DeskRelay
      </a>

      <Show when={props.kind === "privacy"} fallback={<TermsContent />}>
        <PrivacyContent />
      </Show>
    </article>
  );
};

const PrivacyContent: Component = () => (
  <>
    <h1>Privacy for self-hosted DeskRelay</h1>
    <p class="legal-updated">Last updated: 2026-05-06</p>
    <p>
      DeskRelay self is open-source software that you run on your own computers. It is not a
      hosted SaaS, marketplace app, cloud relay, payment product, or managed account service.
    </p>

    <h2>What the project maintainers receive</h2>
    <p>
      The DeskRelay maintainers do not receive, store, or process your chats, prompts, Claude
      responses, files, command output, device list, Site token, daemon tokens, Claude session
      files, or connector logs from a normal self-host installation.
    </p>

    <h2>Where data stays</h2>
    <ul>
      <li>The site backend stores device registration state on the machine where you run it.</li>
      <li>The browser stores the Site token and UI preferences in local browser storage.</li>
      <li>The connector daemon stores its token and local state on the PC where it runs.</li>
      <li>Claude Code session files, command output, files, git state, and MCP config stay on the connector PC.</li>
      <li>The generated command files under <code>.self-server\commands\</code> may contain local access tokens.</li>
    </ul>

    <h2>Third-party services</h2>
    <p>
      Claude Code and any AI provider, package manager, Git host, VPN, SSH provider, operating
      system, or network service you choose to use may handle data under their own policies.
      DeskRelay does not change those terms.
    </p>

    <h2>Your responsibilities</h2>
    <ul>
      <li>Keep Site tokens, daemon tokens, SSH keys, and generated command files private.</li>
      <li>Use LAN, SSH, or a private VPN such as Tailscale instead of exposing ports to the public internet.</li>
      <li>Set workspace roots before remote use if you want to limit which folders Claude Code can reach.</li>
      <li>Delete local state, browser storage, and generated command files when you stop using an instance.</li>
    </ul>

    <h2>한국어 요약</h2>
    <p>
      DeskRelay self는 사용자가 직접 실행하는 오픈소스 도구입니다. 프로젝트 관리자는 일반적인
      self-host 설치에서 채팅, 파일, 명령 결과, 디바이스 목록, 토큰, 로그를 받거나 저장하지
      않습니다. 데이터와 토큰은 사용자의 PC, 브라우저, connector daemon 상태 폴더에 남습니다.
    </p>
    <p class="legal-foot">
      For issues or corrections, use the project repository issue tracker.
    </p>
  </>
);

const TermsContent: Component = () => (
  <>
    <h1>Terms for self-hosted DeskRelay</h1>
    <p class="legal-updated">Last updated: 2026-05-06</p>
    <p>
      DeskRelay self is open-source software that you install and operate yourself. The project
      maintainers do not provide a hosted service, uptime guarantee, account system, paid
      subscription, app-store distribution, cloud relay, or managed support contract for this
      self-host version.
    </p>

    <h2>Use only systems you are allowed to control</h2>
    <p>
      DeskRelay can route prompts to Claude Code and expose file, shell, git, MCP, and tool-use
      surfaces on the connector PC. Use it only on computers, accounts, networks, and projects
      that you own or are authorized to operate.
    </p>

    <h2>Security and operations</h2>
    <ul>
      <li>You are responsible for access control, network exposure, backups, logs, and local tokens.</li>
      <li>Do not expose connector or site ports directly to the public internet.</li>
      <li>Review Claude Code tool calls carefully before approving them.</li>
      <li>Commands run through Claude Code affect the connector PC, not a DeskRelay-managed sandbox.</li>
    </ul>

    <h2>Third-party software</h2>
    <p>
      Claude Code, Anthropic services, Bun, Git, package registries, Tailscale, SSH software, and
      your operating system are separate products with their own terms, licenses, and security
      models. You are responsible for following them.
    </p>

    <h2>License and warranty</h2>
    <p>
      DeskRelay is provided under the licenses in this repository. The software is provided as-is,
      without warranty. To the maximum extent permitted by law, the maintainers are not liable for
      data loss, command execution, service interruption, security incidents, or other damages
      arising from your self-host operation.
    </p>

    <h2>한국어 요약</h2>
    <p>
      DeskRelay self는 가입형 서비스가 아니라 사용자가 직접 설치하고 운영하는 오픈소스
      소프트웨어입니다. 토큰 관리, 네트워크 노출, SSH/VPN 설정, 백업, Claude Code가 실행하는
      명령의 결과는 사용자가 책임집니다. 공용 인터넷에 포트를 직접 열지 말고, 권한 있는
      시스템에서만 사용하세요.
    </p>
    <p class="legal-foot">
      The repository license remains the controlling software license.
    </p>
  </>
);
