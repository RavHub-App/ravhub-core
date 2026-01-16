#!/bin/bash
# test/run-commissioning.sh

# Configuration
TEST_DIR="$(pwd)/test"
SCENARIOS_DIR="$TEST_DIR/e2e/scenarios"
STRESS_DIR="$TEST_DIR/stress"
NUKE_SCRIPT="$TEST_DIR/utils/nuke.sh"
LOG_DIR="/tmp/commissioning_logs"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

echo -e "${YELLOW}======================================================${NC}"
echo -e "${YELLOW}   RavHub On-Premise Commissioning Suite              ${NC}"
echo -e "${YELLOW}======================================================${NC}"
echo "Start Time: $(date)"
echo ""

# Helper: Wait for API to be responsive
wait_for_api() {
    echo -n "   Waiting for API availability..."
    # Wait up to 60 seconds
    for i in {1..60}; do
        # Check simple connectivity (API returns 404 or 200, but curl exit code 0 means connection OK)
        if curl -s --connect-timeout 2 "http://localhost:3000/" > /dev/null; then
            echo " UP!"
            sleep 3 # Extra safety buffer for internal plugin init
            return 0
        fi
        echo -n "."
        sleep 1
    done
    echo -e "${RED} FAIL (Timeout)${NC}"
    return 1
}

run_test() {
    local script="$1"
    local name="$2"
    local needs_restart="$3"

    echo -n "Running $name... "
    
    # Pre-clean
    if [ "$needs_restart" == "yes" ]; then
        $NUKE_SCRIPT --restart > /dev/null
    else
        $NUKE_SCRIPT > /dev/null
    fi
    
    # Always wait for API stability after nuke (especially if restarted)
    if ! wait_for_api > /dev/null; then
         echo -e "${RED}SKIPPED (API Dead)${NC}"
         return 1
    fi

    start_t=$(date +%s)
    if bash "$script" > "$LOG_DIR/${name}.log" 2>&1; then
        end_t=$(date +%s)
        dur=$((end_t - start_t))
        echo -e "${GREEN}PASSED${NC} (${dur}s)"
        return 0
    else
        echo -e "${RED}FAILED${NC} (See $LOG_DIR/${name}.log)"
        return 1
    fi
}

start_global=$(date +%s)

# --- Phase 1: Functional ---
echo -e "${YELLOW}>>> Phase 1: Functional Verification (E2E)${NC}"

# Initial clean slate with restart
$NUKE_SCRIPT --restart > /dev/null
wait_for_api > /dev/null

total=0
failed_tests=""

# Order matters slightly for performance, but cleaning makes them independent.
# Docker needs restart strictly to ensure ports 5001-5005 are free.
# Helm/Nuget mock servers sometimes stick, so restart helps.

# 1. Simple Tests (Fast)
for name in npm raw maven composer pypi rust; do
    ((total++))
    if run_test "$SCENARIOS_DIR/${name}.sh" "$name" "no"; then
        ((passed++))
    else
        failed_tests="$failed_tests $name"
    fi
done

# 2. Complex Tests (Need heavy cleanup/restart potentially)
# Docker opens ports, restart is mandatory for stability here
((total++))
if run_test "$SCENARIOS_DIR/docker.sh" "docker" "yes"; then
    ((passed++))
else
    failed_tests="$failed_tests docker"
fi

# Helm & Nuget use internal mock servers, restart helps ensure ports clear
for name in helm nuget; do
    ((total++))
    if run_test "$SCENARIOS_DIR/${name}.sh" "$name" "yes"; then
        ((passed++))
    else
        failed_tests="$failed_tests $name"
    fi
done

echo ""
echo "Functional Score: $passed / $total"

# --- Phase 2: Stress ---
echo -e "${YELLOW}>>> Phase 2: Load & Performance Verification (Stress)${NC}"

stress_passed=0
stress_total=0
stress_failed=""

# Nuke before stress
$NUKE_SCRIPT --restart > /dev/null

for script in $STRESS_DIR/*.sh; do
    if [ -f "$script" ]; then
        name=$(basename "$script" .sh)
        ((stress_total++))
        
        echo "------------------------------------------------"
        echo "Running $name Load Test..."
        
        # Clean between stress tests too (light clean)
        $NUKE_SCRIPT > /dev/null

        # Run with moderate load
        if bash "$script" 10 5 > "$LOG_DIR/${name}_stress.log" 2>&1; then
             throughput=$(grep "Throughput:" "$LOG_DIR/${name}_stress.log" | head -n1)
             echo -e "${GREEN}PASSED${NC} - $throughput"
             ((stress_passed++))
        else
             echo -e "${RED}FAILED${NC} (See $LOG_DIR/${name}_stress.log)"
             stress_failed="$stress_failed $name"
        fi
    fi
done

end_global=$(date +%s)
duration_global=$((end_global - start_global))

echo ""
echo -e "${YELLOW}======================================================${NC}"
echo -e "${YELLOW}   Commissioning Summary (${duration_global}s)        ${NC}"
echo -e "${YELLOW}======================================================${NC}"
echo "Functional: $passed / $total"
echo "Stress:     $stress_passed / $stress_total"

if [ "$passed" -eq "$total" ] && [ "$stress_passed" -eq "$stress_total" ]; then
     echo -e "${GREEN}>>> ALL SYSTEMS GO - READY FOR PRODUCTION <<<${NC}"
     exit 0
else
     echo -e "${RED}FAILURES DETECTED:${NC}"
     [ ! -z "$failed_tests" ] && echo "Functional: $failed_tests"
     [ ! -z "$stress_failed" ] && echo "Stress: $stress_failed"
     exit 1
fi
