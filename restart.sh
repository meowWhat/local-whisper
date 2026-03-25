#!/bin/bash
# ============================================================
# Local Whisper - 一键重启脚本
# 用法: ./restart.sh
# 功能: 杀掉所有相关进程 → 重新启动 tauri dev → 等待后端就绪
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/tauri-dev.log"
SIDECAR_PORT=11435
HEALTH_URL="http://127.0.0.1:${SIDECAR_PORT}/api/health"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Local Whisper - 重启${NC}"
echo -e "${CYAN}========================================${NC}"

# ----------------------------------------------------------
# 1. 杀掉所有相关进程
# ----------------------------------------------------------
echo -e "\n${YELLOW}[1/4] 停止所有相关进程...${NC}"

# 杀 tauri 二进制
pkill -f "target/debug/local-whisper" 2>/dev/null && echo "  killed tauri binary" || true
# 杀 python sidecar
pkill -f "python.*server\.py" 2>/dev/null && echo "  killed python sidecar" || true
# 杀 vite dev server
pkill -f "vite" 2>/dev/null && echo "  killed vite" || true
# 杀 tauri cli
pkill -f "tauri.*dev" 2>/dev/null && echo "  killed tauri cli" || true
# 杀占用端口的进程
lsof -ti:${SIDECAR_PORT} 2>/dev/null | xargs kill -9 2>/dev/null && echo "  killed port ${SIDECAR_PORT}" || true
lsof -ti:1420 2>/dev/null | xargs kill -9 2>/dev/null && echo "  killed port 1420" || true

sleep 2
echo -e "${GREEN}  所有进程已停止${NC}"

# ----------------------------------------------------------
# 2. 启动 tauri dev (后台)
# ----------------------------------------------------------
echo -e "\n${YELLOW}[2/4] 启动 tauri dev...${NC}"

cd "$PROJECT_DIR"
source "$HOME/.cargo/env" 2>/dev/null || true

# 清空旧日志
> "$LOG_FILE"

nohup pnpm tauri dev > "$LOG_FILE" 2>&1 &
TAURI_PID=$!
echo -e "  PID: ${TAURI_PID}"
echo -e "  日志: ${LOG_FILE}"

# ----------------------------------------------------------
# 3. 等待 Rust 编译完成 + 应用启动
# ----------------------------------------------------------
echo -e "\n${YELLOW}[3/4] 等待编译和启动...${NC}"

MAX_WAIT=120
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if grep -q "\[sidecar\] PID:" "$LOG_FILE" 2>/dev/null; then
        echo -e "  ${GREEN}Tauri 应用已启动${NC}"
        break
    fi
    # 显示编译进度
    LAST_LINE=$(tail -1 "$LOG_FILE" 2>/dev/null | head -c 80)
    if [ -n "$LAST_LINE" ]; then
        printf "\r  %-80s" "$LAST_LINE"
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done
echo ""

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo -e "${RED}  编译超时 (${MAX_WAIT}s)，请检查日志: ${LOG_FILE}${NC}"
    exit 1
fi

# ----------------------------------------------------------
# 4. 等待 Python sidecar 就绪 (health check)
# ----------------------------------------------------------
echo -e "\n${YELLOW}[4/4] 等待 Python sidecar 就绪...${NC}"

MAX_WAIT=60
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    RESP=$(curl -s --max-time 2 "$HEALTH_URL" 2>/dev/null || true)
    if echo "$RESP" | grep -q '"status":"ok"'; then
        echo -e "  ${GREEN}Sidecar 就绪!${NC}"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo -e "${RED}  Sidecar 启动超时，请检查日志: ${LOG_FILE}${NC}"
    exit 1
fi

# ----------------------------------------------------------
# 5. 打印状态摘要
# ----------------------------------------------------------
echo -e "\n${CYAN}========================================${NC}"
echo -e "${GREEN}  重启完成!${NC}"
echo -e "${CYAN}========================================${NC}"

HEALTH=$(curl -s "$HEALTH_URL" 2>/dev/null)
ASR_MODEL=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('asr_model','?'))" 2>/dev/null || echo "?")
LLM_MODEL=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('llm_model','?'))" 2>/dev/null || echo "?")
ASR_OK=$(echo "$HEALTH" | python3 -c "import sys,json; print('YES' if json.load(sys.stdin).get('asr_loaded') else 'NO')" 2>/dev/null || echo "?")
LLM_OK=$(echo "$HEALTH" | python3 -c "import sys,json; print('YES' if json.load(sys.stdin).get('llm_loaded') else 'NO')" 2>/dev/null || echo "?")

echo -e "  ASR: ${ASR_MODEL} (loaded: ${ASR_OK})"
echo -e "  LLM: ${LLM_MODEL} (loaded: ${LLM_OK})"
echo -e "  日志: tail -f ${LOG_FILE}"
echo ""
