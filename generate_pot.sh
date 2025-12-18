#!/bin/bash
OUTPUT="po/io.github.diegopvlk.Dosage.pot"
PACKAGE_NAME="io.github.diegopvlk.Dosage"
ENCODING="UTF-8"
LANGUAGE_BLP="--language=JavaScript"
LINGUAS_FILE="po/LINGUAS"

grep -v '\.blp$' po/POTFILES > /tmp/POTFILES_DOSAGE
grep '\.blp$' po/POTFILES > /tmp/POTFILES_DOSAGE.blp

# create pot
xgettext --files-from=/tmp/POTFILES_DOSAGE \
         --output="$OUTPUT" --package-name="$PACKAGE_NAME" \
         --from-code="$ENCODING" --add-comments \
         --keyword=_ --keyword=C_:1c,2

# join pot
xgettext --files-from=/tmp/POTFILES_DOSAGE.blp \
         --output="$OUTPUT" --package-name="$PACKAGE_NAME" \
         --from-code="$ENCODING" --add-comments \
         --keyword=_ --keyword=C_:1c,2 \
         $LANGUAGE_BLP \
         --join-existing


rm /tmp/POTFILES_DOSAGE /tmp/POTFILES_DOSAGE.blp

sed -i 's/charset=CHARSET/charset=UTF-8/g' $OUTPUT

sed -i '2,3c\
# Copyright (C) 2023 Diego Povliuk\
# This file is distributed under the license GPLv3-or-later.' $OUTPUT


