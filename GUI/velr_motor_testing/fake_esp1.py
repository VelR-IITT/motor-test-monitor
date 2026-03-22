import socket
import time
import random

HOST = "localhost"
PORT = 23

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.bind((HOST, PORT))
server.listen(1)

print("🚀 Fake ESP Simulator running on port 23")

conn, addr = server.accept()
print("Client connected:", addr)

t_start = time.time()

try:
    while True:
        now = time.time()
        tstart = t_start
        tmission = max(0.0, now - t_start)

        # --- State machine ---
        if tmission < 2:
            state = "ARMED"
        elif tmission < 8:
            state = "FIRING"
        else:
            state = "SAFE"

        thrust = random.uniform(0, 500) if state == "FIRING" else 0.0
        pressure = random.uniform(0, 600) if state == "FIRING" else 0.0

        # Continuity simulation
        cont1 = random.choice([random.uniform(2.8, 3.3), random.uniform(0.0, 0.2)])
        cont2 = random.choice([random.uniform(2.8, 3.3), random.uniform(0.0, 0.2)])

        temps = ",".join(
            f"TEMP{i}:{random.uniform(250, 450):.1f}:WORKING"
            for i in range(1, 11)
        )

        line = (
            f"TSTART:{tstart:.2f},"
            f"TMISSION:{tmission:.2f},"
            f"STATE:{state},"
            f"THRUST:{thrust:.2f},"
            f"PRESSURE:{pressure:.2f},"
            f"{temps},"
            f"CONT1:{cont1:.2f},"
            f"CONT2:{cont2:.2f},"
            f"SYS:WORKING\n"
        )

        conn.sendall(line.encode())
        time.sleep(0.1)

except KeyboardInterrupt:
    print("Stopping Fake ESP")
finally:
    conn.close()
    server.close()
