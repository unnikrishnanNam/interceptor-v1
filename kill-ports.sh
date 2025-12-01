#!/bin/bash

# Kill processes on ports 3000, 5432, and 9229
echo "Checking for processes on ports 3000, 5432, and 9229..."

PORTS="3000 5432 9229"
KILLED=0

for PORT in $PORTS; do
  PIDS=$(lsof -ti:$PORT 2>/dev/null)
  if [ ! -z "$PIDS" ]; then
    echo "Killing processes on port $PORT: $PIDS"
    kill -9 $PIDS 2>/dev/null
    KILLED=1
  fi
done

if [ $KILLED -eq 0 ]; then
  echo "No processes found on ports $PORTS"
fi

exit 0
