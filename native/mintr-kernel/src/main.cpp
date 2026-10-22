#include "kernel.hpp"
#include "protocol.hpp"

#include <Message.hxx>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>

int main() {
  Message::DefaultMessenger()->ChangePrinters().Clear();
  static std::ofstream occtLog("NUL");
  std::cout.rdbuf(occtLog.rdbuf());
  setStdioBinary();
  std::string payload;
  while (readFrame(payload)) {
    nlohmann::json reply;
    try {
      const auto job = nlohmann::json::parse(payload);
      reply = handleKernelJob(job);
      if (job.contains("id")) reply["id"] = job["id"];
    } catch (...) {
      reply = { { "ok", false }, { "fallback", true }, { "message", "invalid kernel frame" } };
    }
    if (!writeFrame(reply.dump())) break;
  }
  return 0;
}
