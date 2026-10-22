#pragma once

#include <cstdint>
#include <string>

bool readFrame(std::string& payload);
bool writeFrame(const std::string& payload);
void setStdioBinary();
