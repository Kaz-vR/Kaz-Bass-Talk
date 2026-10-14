cmake_minimum_required(VERSION 3.22)
project(LowTalk VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE: a local checkout (-DLOWTALK_JUCE_DIR=...) or fetched at configure time (build machine only;
# the plugin itself never touches the network).
if(LOWTALK_JUCE_DIR)
  add_subdirectory(${LOWTALK_JUCE_DIR} juce)
else()
  include(FetchContent)
  FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.4 GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(JUCE)
endif()

# VST3 only for release; a local Standalone build (-DLOWTALK_FORMATS="VST3;Standalone") helps to look at the window.
set(LOWTALK_FORMATS VST3 CACHE STRING "Plugin formats")

juce_add_plugin(LowTalk
  COMPANY_NAME "Low Talk"
  BUNDLE_ID "com.lowtalk.lowtalk"
  PLUGIN_MANUFACTURER_CODE Lwtk
  PLUGIN_CODE Lwt1
  FORMATS ${LOWTALK_FORMATS}
  PRODUCT_NAME "Low Talk"
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  COPY_PLUGIN_AFTER_BUILD FALSE
  VST3_CATEGORIES Instrument Synth)

juce_generate_juce_header(LowTalk)
juce_add_binary_data(LowTalkData SOURCES resources/presets.json)

target_sources(LowTalk PRIVATE source/PluginProcessor.cpp source/PluginEditor.cpp)
target_include_directories(LowTalk PRIVATE engine)
target_compile_definitions(LowTalk PUBLIC
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(LowTalk
  PRIVATE LowTalkData juce::juce_audio_utils juce::juce_audio_processors
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)

# Dev tool: renders a patch with the C++ engine for the parity check (tools/plugin-parity.ts).
add_executable(lowtalk_render tools/render_cli.cpp)
target_include_directories(lowtalk_render PRIVATE engine)

# Dev test: the plugin-only engine additions (MPE, host-locked pump clock).
add_executable(lowtalk_engine_test tools/engine_test.cpp)
target_include_directories(lowtalk_engine_test PRIVATE engine)
