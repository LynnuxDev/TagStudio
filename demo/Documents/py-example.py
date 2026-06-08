import random
import time

def roll_dice(sides=6):
    return random.randint(1, sides)

def fake_processing(task_name):
    print(f"Starting task: {task_name}")
    for i in range(3):
        time.sleep(0.2)
        print(f"Processing... {i+1}/3")
    print("Done!")

if __name__ == "__main__":
    print("Dice roll:", roll_dice())

    tasks = ["index files", "scan directory", "build cache"]
    fake_processing(random.choice(tasks))
