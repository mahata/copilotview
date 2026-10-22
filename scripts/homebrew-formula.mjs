function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [version, sha256] = process.argv.slice(2);
if (version === undefined || sha256 === undefined) {
  fail("usage: node scripts/homebrew-formula.mjs <version> <sha256>");
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`Invalid version ${version}; expected a version such as 1.2.3 without the leading v.`);
}
if (!/^[0-9a-f]{64}$/.test(sha256)) {
  fail(`Invalid sha256 ${sha256}; expected 64 lowercase hexadecimal characters.`);
}

// The release tarball's cli.js isn't executable, so the wrapper runs it with Homebrew's node
// rather than relying on its shebang, which would pick up whichever node comes first on PATH.
process.stdout.write(`class Copilotview < Formula
  desc "Browse, search and summarize past GitHub Copilot CLI sessions"
  homepage "https://github.com/mahata/copilotview"
  url "https://github.com/mahata/copilotview/releases/download/v${version}/copilotview-${version}.tar.gz"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    libexec.install "cli.js", "web", "VERSION"
    (bin/"copilotview").write <<~SH
      #!/bin/bash
      exec "#{formula_opt_bin("node")}/node" "#{libexec}/cli.js" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/copilotview --version")

    (testpath/"sessions").mkpath
    system bin/"copilotview", "index", "--source", testpath/"sessions", "--index", testpath/"index.db"
    assert_match "Sessions:   0", shell_output("#{bin}/copilotview stats --index #{testpath}/index.db")

    port = free_port
    pid = spawn bin/"copilotview", "serve", "--source", testpath/"sessions", "--index", testpath/"index.db",
                "--port", port.to_s
    url = "http://127.0.0.1:#{port}/"
    assert_match "<title>copilotview</title>",
                 shell_output("curl -fsS --retry 10 --retry-connrefused --retry-delay 1 #{url}")
  ensure
    if pid
      Process.kill("TERM", pid)
      Process.wait(pid)
    end
  end
end
`);
