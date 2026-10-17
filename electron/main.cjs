// A second PeakCAD process with --mcp speaks MCP on stdin and never opens a window.
if (process.argv.includes("--mcp")) {
  require("./mcpStdio.cjs");
} else {
  require("./desktopMain.cjs");
}
