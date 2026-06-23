import csv
from datetime import datetime, timedelta
import random

# Данные учеников и сотрудников
people = [
    {"id": "1001", "roll": "1", "name": "Иванов Александр", "department": "9А"},
    {"id": "1002", "roll": "2", "name": "Петрова Мария", "department": "9А"},
    {"id": "1003", "roll": "3", "name": "Сидоров Дмитрий", "department": "9А"},
    {"id": "1004", "roll": "4", "name": "Козлова Анна", "department": "9А"},
    {"id": "1005", "roll": "5", "name": "Морозов Иван", "department": "9А"},
    {"id": "2001", "roll": "1", "name": "Васильева Екатерина", "department": "10Б"},
    {"id": "2002", "roll": "2", "name": "Павлов Андрей", "department": "10Б"},
    {"id": "2003", "roll": "3", "name": "Соколова Дарья", "department": "10Б"},
    {"id": "333", "roll": "45", "name": "Игошина София Романовна", "department": "9"},
    {"id": "44", "roll": "44", "name": "Учитель Иванова Мария Петровна", "department": "Учитель математики"},
]

# Генерируем записи за последнюю неделю
attendance = []
start_date = datetime.now().replace(hour=8, minute=0, second=0) - timedelta(days=7)

for day in range(7):  # 7 дней
    current_date = start_date + timedelta(days=day)
    if current_date.weekday() >= 5:  # пропускаем выходные
        continue

    for person in people:
        # Учителя приходят к 8:30
        if "Учитель" in person["name"]:
            time_in = current_date.replace(hour=8, minute=random.randint(25, 35))
        else:
            # Ученики с 8:00 до 8:20
            time_in = current_date.replace(hour=8, minute=random.randint(0, 20))

        # Некоторые могут опоздать (10% случаев)
        if random.random() < 0.1:
            time_in = current_date.replace(hour=8, minute=random.randint(25, 45))
            status = "Опоздал"
        else:
            status = "Присутствует"

        # Некоторые могут отсутствовать (5% случаев)
        if random.random() < 0.05:
            continue  # пропускаем запись - отсутствует

        attendance.append([
            person["id"],
            person["roll"],
            person["name"],
            person["department"],
            time_in.strftime("%H:%M:%S"),
            time_in.strftime("%d/%m/%Y"),
            status
        ])

# Сортируем по дате и времени
attendance.sort(key=lambda x: datetime.strptime(x[5] + " " + x[4], "%d/%m/%Y %H:%M:%S"))

# Сохраняем в CSV
with open("attendance.csv", "w", newline="", encoding="utf-8") as file:
    writer = csv.writer(file)
    writer.writerow(["ID", "Roll", "Name", "Department", "Time", "Date", "Status"])
    writer.writerows(attendance)

print(f"Добавлено {len(attendance)} записей посещаемости")
for a in attendance[:10]:
    print(f"   {a[5]} {a[4]} - {a[2]} - {a[6]}")