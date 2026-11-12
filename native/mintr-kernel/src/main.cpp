#include "fillet.hpp"
#include "kernel.hpp"
#include "protocol.hpp"

#include <Message.hxx>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>

int main() {
  Message::DefaultMessenger()->ChangePrinters().Clear();
#ifdef _WIN32
  static std::ofstream occtLog("NUL");
#else
  static std::ofstream occtLog("/dev/null");
#endif
  std::cout.rdbuf(occtLog.rdbuf());
  setStdioBinary();
  std::string payload;
  while (readFrame(payload)) {
    nlohmann::json reply;
    try {
      const auto job = nlohmann::json::parse(payload);
      reply = handleKernelJob(job);
      if (job.contains("id")) reply["id"] = job["id"];
      if (job.value("packMesh", false)) packMeshArrays(reply);
    } catch (...) {
      reply = { { "ok", false }, { "fallback", true }, { "message", "invalid kernel frame" } };
    }
    if (!writeFrame(reply.dump())) break;
    // A blend build left spinning on its own thread would burn a core for the rest of the
    // session; the desktop app starts a fresh engine for the next request.
    if (kernelNeedsRestart()) break;
  }
  return 0;
}
