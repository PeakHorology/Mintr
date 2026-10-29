// The browser build's way in: the same handleKernelJob the desktop's main.cpp serves over
// stdio, called from a web worker instead. One engine, so a fix lands in both apps at once.
#include "kernel.hpp"
#include "protocol.hpp"

#include <Message.hxx>
#include <emscripten/emscripten.h>
#include <nlohmann/json.hpp>
#include <string>

extern "C" {

/** One job in, one reply out, both JSON text. The reply lives until the next call. */
EMSCRIPTEN_KEEPALIVE const char* mintrHandleJob(const char* payload) {
  static const bool quiet = [] {
    Message::DefaultMessenger()->ChangePrinters().Clear();
    return true;
  }();
  (void)quiet;
  static std::string reply;
  nlohmann::json out;
  try {
    const auto job = nlohmann::json::parse(payload);
    out = handleKernelJob(job);
    if (job.contains("id")) out["id"] = job["id"];
    if (job.value("packMesh", false)) packMeshArrays(out);
  } catch (...) {
    out = { { "ok", false }, { "fallback", true }, { "message", "invalid kernel frame" } };
  }
  reply = out.dump();
  return reply.c_str();
}

}
