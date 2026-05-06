class CrConnector < Formula
  desc "Daemon that bridges the DeskRelay site to claude CLI on this PC"
  homepage "https://github.com/darkhtk/deskrelay"
  version "{{VERSION}}"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "{{URL_DARWIN_ARM64}}"
      sha256 "{{SHA_DARWIN_ARM64}}"
    end
    on_intel do
      url "{{URL_DARWIN_X64}}"
      sha256 "{{SHA_DARWIN_X64}}"
    end
  end

  on_linux do
    on_intel do
      url "{{URL_LINUX_X64}}"
      sha256 "{{SHA_LINUX_X64}}"
    end
  end

  def install
    # Layout we want at install time:
    #   libexec/cr-connector              (the actual binary)
    #   libexec/behaviors/remote-claude/  (first-party free behaviors)
    #   bin/cr-connector                  (symlink → libexec/cr-connector)
    #
    # The daemon's behavior auto-discovery uses dirname(process.execPath),
    # so behaviors must sit next to the *real* binary (libexec), not next
    # to the bin shim. The symlink is enough because brew's bin/ entries
    # don't rewrite process.execPath.
    bin_files = Dir["cr-connector-*"].reject { |f| File.directory?(f) }
    odie "no cr-connector binary found in release archive" if bin_files.empty?
    libexec.install bin_files.first => "cr-connector"
    libexec.install "behaviors" if Dir.exist?("behaviors")
    bin.install_symlink libexec/"cr-connector"
  end

  test do
    assert_match "cr-connector — pair this PC", shell_output("#{bin}/cr-connector --help")
  end
end
