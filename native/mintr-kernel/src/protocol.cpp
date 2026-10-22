#include "protocol.hpp"

#include <cstdio>
#include <cstdint>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

void setStdioBinary() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  setvbuf(stdin, nullptr, _IONBF, 0);
  setvbuf(stdout, nullptr, _IONBF, 0);
}

bool readFrame(std::string& payload) {
  unsigned char header[4];
  if (std::fread(header, 1, 4, stdin) != 4) return false;
  const std::uint32_t size =
    static_cast<std::uint32_t>(header[0])
    | (static_cast<std::uint32_t>(header[1]) << 8)
    | (static_cast<std::uint32_t>(header[2]) << 16)
    | (static_cast<std::uint32_t>(header[3]) << 24);
  if (size == 0 || size > 256u * 1024u * 1024u) return false;
  payload.resize(size);
  return std::fread(payload.data(), 1, size, stdin) == size;
}

bool writeFrame(const std::string& payload) {
  const auto size = static_cast<std::uint32_t>(payload.size());
  unsigned char header[4] = {
    static_cast<unsigned char>(size & 0xff),
    static_cast<unsigned char>((size >> 8) & 0xff),
    static_cast<unsigned char>((size >> 16) & 0xff),
    static_cast<unsigned char>((size >> 24) & 0xff),
  };
  if (std::fwrite(header, 1, 4, stdout) != 4) return false;
  if (std::fwrite(payload.data(), 1, payload.size(), stdout) != payload.size()) return false;
  std::fflush(stdout);
  return true;
}
