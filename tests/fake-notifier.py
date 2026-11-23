#!/usr/bin/python3
import json
import os
import sys
import time

args = sys.argv[1:]
with open(os.path.join(os.environ['DOSAGE_TEST_TMP'], 'notifications.jsonl'), 'a') as stream:
    stream.write(json.dumps(args) + '\n')
if '-message' in args:
    title = args[args.index('-title') + 1]
    if title == 'delayed':
        time.sleep(0.3)
    if '-action' in args:
        print('Confirm')
