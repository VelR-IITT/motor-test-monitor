import socket
import time
import random
import threading

HOST = "localhost"
PORT = 23

# ===================== SYSTEM STATES =====================
SYSTEM_SAFE = 0
SYSTEM_IDLE = 1
SYSTEM_ARMED = 2
SYSTEM_IGNITION = 3
SYSTEM_POST_IGNITION = 4

state = SYSTEM_SAFE
fire_start_time = None
running = True
lock = threading.Lock()

# ===================== SOCKET SETUP ======================
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.bind((HOST, PORT))
server.listen(1)

print("🚀 Fake ESP Simulator (NEW PROTOCOL) running on port 23")

conn, addr = server.accept()
print("Client connected:", addr)

# ===================== COMMAND HANDLER ===================
def command_listener():
    global state, fire_start_time, running

    while running:
        try:
            data = conn.recv(1024)
            if not data:
                break

            cmd = data.decode().strip().upper()
            print("📡 Command received:", cmd)

            with lock:
                if cmd == "ARM" and state == SYSTEM_IDLE:
                    state = SYSTEM_ARMED
                    conn.sendall(b"ACK\n")

                elif cmd == "DAR":
                    state = SYSTEM_SAFE
                    fire_start_time = None
                    conn.sendall(b"ACK\n")

                elif cmd == "FIR" and state == SYSTEM_ARMED:
                    state = SYSTEM_IGNITION
                    fire_start_time = time.time()
                    conn.sendall(b"ACK\n")

                elif cmd == "SLG":
                    conn.sendall(b"ACK\n")

                elif cmd.startswith("CAL"):
                    conn.sendall(b"ACK\n")

                elif cmd.startswith("TIM"):
                    print(f"📝 Timestamp received: {cmd[3:].strip()}")
                    conn.sendall(b"ACK\n")

                else:
                    conn.sendall(b"ERR:INVALID_STATE\n")

        except Exception as e:
            print("Command error:", e)
            break

# ===================== START THREAD ======================
threading.Thread(target=command_listener, daemon=True).start()

# ===================== TELEMETRY LOOP ====================
try:
    start_time = time.time()

    while running:
        with lock:
            now = time.time()

            # Time in milliseconds
            time_ms = (now - start_time) * 1000

            # Auto state transition
            if state == SYSTEM_IGNITION and fire_start_time:
                if now - fire_start_time > 5:
                    state = SYSTEM_POST_IGNITION

            # Thrust & pressure
            if state == SYSTEM_IGNITION:
                thrust = random.uniform(200, 500)
                pressure = random.uniform(300, 600)
            else:
                thrust = 0.0
                pressure = 0.0

            # 11 temperature sensors
            temps = [
                f"{random.uniform(200, 450):.2f}"
                for _ in range(11)
            ]

            # Continuity voltages
            cont1 = random.uniform(2.8, 3.3)
            cont2 = random.uniform(2.8, 3.3)

            # Final CSV line (NO TEXT)
            line = ",".join([
                f"{time_ms:.2f}",
                f"{thrust:.2f}",
                f"{pressure:.2f}",
                *temps,
                str(state),
                f"{cont1:.2f}",
                f"{cont2:.2f}",
            ]) + "\n"

        conn.sendall(line.encode())
        time.sleep(0.1)

except KeyboardInterrupt:
    print("Stopping Fake ESP")

finally:
    running = False
    conn.close()
    server.close()
    print("Fake ESP stopped")
