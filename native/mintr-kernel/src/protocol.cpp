#include "protocol.hpp"

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>

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

namespace {

std::string base64(const unsigned char* data, std::size_t size) {
  static const char* table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((size + 2) / 3) * 4);
  std::size_t i = 0;
  for (; i + 2 < size; i += 3) {
    const std::uint32_t n = (static_cast<std::uint32_t>(data[i]) << 16) | (static_cast<std::uint32_t>(data[i + 1]) << 8) | data[i + 2];
    out.push_back(table[(n >> 18) & 63]);
    out.push_back(table[(n >> 12) & 63]);
    out.push_back(table[(n >> 6) & 63]);
    out.push_back(table[n & 63]);
  }
  if (i < size) {
    std::uint32_t n = static_cast<std::uint32_t>(data[i]) << 16;
    if (i + 1 < size) n |= static_cast<std::uint32_t>(data[i + 1]) << 8;
    out.push_back(table[(n >> 18) & 63]);
    out.push_back(table[(n >> 12) & 63]);
    out.push_back(i + 1 < size ? table[(n >> 6) & 63] : '=');
    out.push_back('=');
  }
  return out;
}

bool endsWith(const std::string& text, const char* suffix) {
  const std::size_t n = std::strlen(suffix);
  return text.size() >= n && text.compare(text.size() - n, n, suffix) == 0;
}

bool allNumbers(const nlohmann::json& list) {
  for (const auto& value : list) {
    if (!value.is_number()) return false;
  }
  return true;
}

} // namespace

void packMeshArrays(nlohmann::json& reply) {
  if (reply.is_array()) {
    for (auto& item : reply) packMeshArrays(item);
    return;
  }
  if (!reply.is_object()) return;
  for (auto it = reply.begin(); it != reply.end(); ++it) {
    auto& value = it.value();
    const std::string& key = it.key();
    const bool floats = endsWith(key, "ositions") || endsWith(key, "ormals");
    const bool whole = key == "indices";
    if ((floats || whole) && value.is_array() && !value.empty() && allNumbers(value)) {
      if (floats) {
        std::vector<float> packed;
        packed.reserve(value.size());
        for (const auto& number : value) packed.push_back(number.get<float>());
        value = { { "$f32", base64(reinterpret_cast<const unsigned char*>(packed.data()), packed.size() * sizeof(float)) } };
      } else {
        std::vector<std::uint32_t> packed;
        packed.reserve(value.size());
        for (const auto& number : value) packed.push_back(number.get<std::uint32_t>());
        value = { { "$u32", base64(reinterpret_cast<const unsigned char*>(packed.data()), packed.size() * sizeof(std::uint32_t)) } };
      }
      continue;
    }
    if (value.is_object() || value.is_array()) packMeshArrays(value);
  }
}
