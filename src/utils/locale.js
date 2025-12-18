/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import GLib from 'gi://GLib?version=2.0';
import Xdp from 'gi://Xdp?version=1.0';

const decoder = new TextDecoder();

export const [firstWeekday, firstWorkDay] = getWeekdays();
export const [clockIs12, amPmStr, timeDot, timeFormat, dateFormat] = checkLocale();

export function getDayLabel(day, long) {
	const now = GLib.DateTime.new_now_local();
	const date = now.add_days((day - now.get_day_of_week() + 7) % 7);
	const dayLabel = date.format(long ? '%A' : '%a');
	return dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
}

export function getSpecificDaysLabel(item) {
	const workdays = Array.from({ length: 5 }, (_, idx) => (firstWorkDay + idx) % 7);
	const weekends = [0, 6].filter(day => !workdays.includes(day));
	const isWeekend = item.days.every(day => weekends.includes(day));
	const isWeekdays = item.days.every(day => workdays.includes(day));
	const days = item.days;
	let newLabel;

	if (item.days.length === 1) {
		newLabel = getDayLabel(item.days[0], 'long');
	} else if (isWeekend && item.days.length === 2) {
		newLabel = _('Weekends');
	} else if (isWeekdays && item.days.length === 5) {
		newLabel = _('Weekdays');
	} else if (item.days.length === 7) {
		newLabel = _('Daily');
	} else {
		const sortedDays = [];
		for (let i = 0; i < 7; i++) {
			const idx = (firstWeekday + i) % 7;
			if (days.includes(idx)) sortedDays.push(idx);
		}
		newLabel = sortedDays.map(day => getDayLabel(day)).join(', ');
	}

	return newLabel;
}

function getWeekdays() {
	let firstWeekday = 0;
	let firstWorkDay = 1;

	try {
		const [, weekdayOutput] = GLib.spawn_command_line_sync('locale first_weekday');
		const [, workDayOutput] = GLib.spawn_command_line_sync('locale first_workday');

		// minus 1 because `locale` days are 1 to 7
		firstWeekday = +decoder.decode(weekdayOutput) - 1;
		firstWorkDay = +decoder.decode(workDayOutput) - 1;
	} catch (error) {
		console.error(error);
	}

	return [firstWeekday, firstWorkDay];
}

// can't use Intl.DateTimeFormat, toLocaleDateString or toLocaleTimeString
// in historyFactory, it crashes the snap (old gjs version?)
// plus GLib.DateTime is a bit faster
function getDateFormat(locale) {
	const formattedDateParts = new Intl.DateTimeFormat(locale, {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	}).formatToParts(new Date());

	const formatMapping = {
		weekday: '%A',
		month: '%b',
		day: '%-e',
		year: '%Y',
		literal: '',
	};

	let dateFormat = '';

	formattedDateParts.forEach(part => {
		if (formatMapping[part.type]) {
			dateFormat += formatMapping[part.type];
		} else if (part.type === 'literal') {
			dateFormat += part.value; // literals (commas, "o'clock", "de", etc)
		}
	});

	const dateTime = GLib.DateTime.new_now_local();
	const monthDT = dateTime.format('%b');

	const monthPart = formattedDateParts.find(part => part.type === 'month');
	if (monthPart && monthPart.value.endsWith('.') && !monthDT.endsWith('.')) {
		dateFormat = dateFormat.replace('%b', '%b.');
	}

	return dateFormat;
}

function checkLocale() {
	const systemOpts = new Intl.DateTimeFormat().resolvedOptions();
	const locale = systemOpts.locale;
	let is12 = false;
	let amPmStr = 'AM;PM';
	let timeDot = false;
	let timeFormat = '%H:%M';
	let dateFormat = getDateFormat(locale);

	try {
		const portal = new Xdp.Portal();
		const currentDesktop = GLib.getenv('XDG_CURRENT_DESKTOP');
		const isGnome = currentDesktop && currentDesktop === 'GNOME';

		const [, outputAmPm] = GLib.spawn_command_line_sync('locale am_pm');
		const [, outputTimeFmt] = GLib.spawn_command_line_sync('locale t_fmt');
		const outTimeFormat = decoder.decode(outputTimeFmt).replace('\n', '');
		const outAmPm = decoder.decode(outputAmPm).replace('\n', '');

		amPmStr = outAmPm === ';' ? amPmStr : outAmPm;
		amPmStr = amPmStr.split(';');

		is12 =
			outTimeFormat.includes('%r') || outTimeFormat.includes('%p') || outTimeFormat.includes('%P');

		if (isGnome) {
			const sett = portal.get_settings();
			const clockFormat = sett.read_string('org.gnome.desktop.interface', 'clock-format', null);
			is12 = clockFormat === '12h' ? true : false;
		}

		timeFormat = is12 ? '%-I:%M %p' : '%H:%M';

		timeDot = outTimeFormat.includes('.');

		if (timeDot) {
			timeFormat = timeFormat.replace(':', '.');
		}
	} catch (error) {
		console.error(error);
	}

	return [is12, amPmStr, timeDot, timeFormat, dateFormat];
}
