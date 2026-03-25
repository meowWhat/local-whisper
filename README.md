# Local Whisper

一个类似 [Typeless](https://typeless.ch/) 的本地语音转文字桌面应用。按住快捷键录音，松开后自动转写并优化文本。所有推理完全在本地运行，无需联网。

## 特性

- **按住录音**：按住 `` ` ``（反引号）键录音，松开自动转写
- **本地 ASR**：使用 SenseVoice-Small（默认）/ Paraformer / Whisper Tiny，通过 sherpa-onnx 运行
- **本地 LLM 优化**：使用 Qwen2.5-0.5B/1.5B（通过 llama.cpp）对 ASR 结果进行纠错和标点优化
- **模型切换**：设置页支持 ASR 和 LLM 模型的在线下载和切换
- **自定义 Prompt**：可自定义 LLM 的优化 Prompt
- **性能监控**：Console Panel 实时显示每个环节的耗时
- **跨平台**：基于 Tauri，支持 macOS / Windows / Linux

## 架构

```
┌─────────────────────────────────────────────┐
│  Tauri App (React + TypeScript + Tailwind)  │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Record  │ │ Settings │ │   Console    │  │
│  │  (Home)  │ │  (Model  │ │  (Perf       │  │
│  │         │ │  Switch) │ │   Monitor)   │  │
│  └────┬────┘ └──────────┘ └──────────────┘  │
│       │ HTTP (localhost:11435)               │
├───────┼─────────────────────────────────────┤
│  Python Sidecar (FastAPI)                    │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │  ASR Engine   │  │   LLM Engine         │  │
│  │  (sherpa-onnx)│  │   (llama-cpp-python) │  │
│  └──────────────┘  └──────────────────────┘  │
│  ┌──────────────────────────────────────────┐│
│  │  Model Manager (download & manage)       ││
│  └──────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

## 快速开始

### 前置条件

- **Node.js** >= 18
- **Rust** (会由 setup 脚本自动安装)
- **Python** >= 3.10
- **pnpm** (推荐)

### 安装

```bash
# 1. 克隆项目
git clone <repo-url>
cd local-whisper

# 2. 一键安装（安装依赖 + 下载默认模型）
chmod +x setup.sh
./setup.sh
```

### 开发模式运行

需要同时启动 Python 后端和 Tauri 前端：

```bash
# 终端 1: 启动 Python sidecar
cd python-sidecar
source venv/bin/activate
python server.py

# 终端 2: 启动 Tauri 开发模式
pnpm tauri dev
```

### 使用方法

1. 启动应用后，进入 **Settings** 页面
2. 下载所需的 ASR 模型（推荐 SenseVoice Small）
3. 可选：下载 LLM 模型（推荐 Qwen2.5 0.5B）
4. 点击 **Use** 激活模型
5. 回到 **Record** 页面，按住 `` ` `` 键开始录音
6. 松开后自动转写，结果显示在页面上
7. 在 **Console** 页面查看每次转写的详细耗时

## 模型说明

### ASR 模型

| 模型 | 速度 | 准确率 | 大小 | 说明 |
|------|------|--------|------|------|
| SenseVoice Small | 极快 (70ms/10s) | 高 | ~230MB | 推荐，非自回归架构 |
| Paraformer | 快 | 高 | ~220MB | FunASR 系列 |
| Whisper Tiny | 中等 | 中等 | ~120MB | 多语言支持好 |

### LLM 模型

| 模型 | 速度 | 质量 | 大小 | 说明 |
|------|------|------|------|------|
| Qwen2.5 0.5B | 极快 | 基础 | ~400MB | 推荐，中英文支持好 |
| Qwen2.5 1.5B | 快 | 较好 | ~1.1GB | 质量更好 |
| Disabled | - | - | 0 | 跳过 LLM，直接输出 ASR 结果 |

## 项目结构

```
local-whisper/
├── src/                    # 前端源码 (React + TypeScript)
│   ├── App.tsx            # 主应用组件
│   ├── api.ts             # API 客户端
│   ├── useRecorder.ts     # 录音 Hook
│   ├── store.ts           # 状态类型定义
│   ├── index.css          # 全局样式
│   └── pages/
│       ├── Home.tsx       # 录音主页
│       ├── Settings.tsx   # 设置页（模型切换）
│       └── Console.tsx    # 性能监控面板
├── src-tauri/             # Tauri Rust 后端
│   ├── src/lib.rs         # Rust 入口
│   ├── Cargo.toml         # Rust 依赖
│   └── tauri.conf.json    # Tauri 配置
├── python-sidecar/        # Python 后端服务
│   ├── server.py          # FastAPI 服务入口
│   ├── asr_engine.py      # ASR 推理引擎
│   ├── llm_engine.py      # LLM 推理引擎
│   ├── model_manager.py   # 模型下载管理
│   └── requirements.txt   # Python 依赖
├── setup.sh               # 一键安装脚本
└── package.json           # Node.js 依赖
```

## 技术选型

- **桌面框架**: Tauri v2 (Rust + WebView)
- **前端**: React + TypeScript + TailwindCSS v4
- **ASR 引擎**: sherpa-onnx (SenseVoice / Paraformer / Whisper)
- **LLM 引擎**: llama-cpp-python (Qwen2.5 GGUF)
- **后端 API**: Python FastAPI
- **通信**: HTTP REST API (localhost:11435)

## License

MIT
