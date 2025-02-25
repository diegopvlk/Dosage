/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

const decoder = new TextDecoder();

const [firstWeekday, firstWorkDay] = getWeekdays();
export { firstWeekday, firstWorkDay };

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

export const [clockIs12, amPmStr, timeDot, timeFormat, dateFormat] = checkLocale();

function checkLocale() {
	const systemOpts = new Intl.DateTimeFormat().resolvedOptions();
	const locale = systemOpts.locale;
	let is12 = false;
	let amPmStr = 'AM;PM';
	let timeDot = false;
	let timeFormat = '%H:%M';
	let dateFormat = getDateFormat(locale);

	try {
		const [, outputAmPm] = GLib.spawn_command_line_sync('locale am_pm');
		const [, outputTimeFmt] = GLib.spawn_command_line_sync('locale t_fmt');
		const outTimeFormat = decoder.decode(outputTimeFmt).replace('\n', '');
		const outAmPm = decoder.decode(outputAmPm).replace('\n', '');

		amPmStr = outAmPm === ';' ? amPmStr : outAmPm;
		amPmStr = amPmStr.split(';');

		is12 =
			outTimeFormat.includes('%r') || outTimeFormat.includes('%p') || outTimeFormat.includes('%P');

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

export const DataDir = Gio.file_new_for_path(GLib.build_filenamev([GLib.get_user_data_dir()]));

export function addLeadZero(input) {
	return String(input).padStart(2, 0);
}

export function isValidTreatmentItem(it) {
	const item = it.obj ? it.obj : it;

	const isValidItem =
		typeof item.name === 'string' &&
		item.name.trim() !== '' && // name cannot be empty
		typeof item.unit === 'string' &&
		item.unit.trim() !== '' && // unit cannot be empty
		typeof item.notes === 'string' &&
		typeof item.frequency === 'string' &&
		// frequency cannot be empty
		item.frequency !== '' &&
		// if frequency is 'specific-days', 'days' cannot be empty
		(item.frequency !== 'specific-days' || item.days.length > 0) &&
		// if frequency is 'day-of-month', 'monthDay' cannot be empty
		(item.frequency !== 'day-of-month' || typeof item.monthDay === 'number') &&
		typeof item.color === 'string' &&
		item.color !== '' && // color cannot be empty
		typeof item.icon === 'string' &&
		item.icon !== '' && // icon cannot be empty
		Array.isArray(item.days) &&
		// days must contain only numbers
		item.days.every(day => typeof day === 'number') &&
		Array.isArray(item.cycle) &&
		item.cycle.length > 0 && // cycle cannot be empty
		// cycle must contain only numbers
		item.cycle.every(day => typeof day === 'number') &&
		Array.isArray(item.dosage) &&
		item.dosage.length > 0 && // dosage must have at least one object
		item.dosage.every(
			d =>
				Array.isArray(d.time) &&
				d.time.length === 2 &&
				typeof d.time[0] === 'number' &&
				typeof d.time[1] === 'number' &&
				typeof d.dose === 'number' &&
				(d.lastTaken === null || typeof d.lastTaken === 'string'),
		) &&
		typeof item.markConfirmed === 'boolean' &&
		typeof item.notification === 'object' &&
		typeof item.notification.increasePriority === 'boolean' &&
		typeof item.notification.recurring === 'object' &&
		typeof item.notification.recurring.enabled === 'boolean' &&
		typeof item.notification.recurring.interval === 'number' &&
		typeof item.inventory === 'object' &&
		typeof item.inventory.enabled === 'boolean' &&
		typeof item.inventory.current === 'number' &&
		typeof item.inventory.reminder === 'number' &&
		typeof item.inventory.refill === 'number' &&
		typeof item.duration === 'object' &&
		typeof item.duration.enabled === 'boolean' &&
		typeof item.duration.start === 'number' &&
		typeof item.duration.end === 'number' &&
		// cycleNextDate is present only if frequency is 'cycle'
		(item.frequency !== 'cycle' || typeof item.cycleNextDate === 'string');

	if (!isValidItem) {
		throw `Invalid treatment item\n\n${JSON.stringify(item)}`;
	}

	return true;
}

export function isValidHistoryItem(it) {
	const item = it.obj ? it.obj : it;

	const isValidItem =
		typeof item.name === 'string' &&
		item.name.trim() !== '' &&
		typeof item.unit === 'string' &&
		item.unit.trim() !== '' &&
		Array.isArray(item.time) &&
		item.time.length === 2 &&
		typeof item.time[0] === 'number' &&
		typeof item.time[1] === 'number' &&
		typeof item.dose === 'number' &&
		typeof item.color === 'string' &&
		item.color !== '' &&
		Array.isArray(item.taken) &&
		item.taken.length === 2 &&
		typeof item.taken[0] === 'number' &&
		typeof item.taken[1] === 'number';

	if (!isValidItem) {
		throw `Invalid history item\n\n${JSON.stringify(item)}`;
	}

	return true;
}

export function createTempObj(type, listStore, lsIsEmpty) {
	const tempObj = {};
	tempObj[type] = [];
	let isValid = false;

	if (lsIsEmpty) return tempObj;

	for (const it of listStore) {
		const item = it.obj;

		if (type === 'history') {
			isValid = isValidHistoryItem(it);
		} else {
			isValid = isValidTreatmentItem(it);
		}

		if (isValid) tempObj[type].push(item);
		else break;
	}

	if (isValid) return tempObj;
}

export function handleCalendarSelect(calendar, calendarRow, oneTime) {
	const today = GLib.DateTime.new_now_local().format('%F');

	calendar.connect('day-selected', cal => handleSelect(cal));
	calendar.connect('next-month', cal => handleSelect(cal));
	calendar.connect('next-year', cal => handleSelect(cal));
	calendar.connect('prev-month', cal => handleSelect(cal));
	calendar.connect('prev-year', cal => handleSelect(cal));

	function handleSelect(cal) {
		const selDate = cal.get_date().format('%F');

		if (oneTime && selDate > today) {
			(async function () {
				cal.add_css_class('calendar-error');
				await new Promise(res => setTimeout(res, 500));
				cal.remove_css_class('calendar-error');
			})();
			cal.select_day(GLib.DateTime.new_now_local());
		}

		calendarRow.subtitle = cal.get_date().format('%x');
	}
}

export function isTodayMedDay(
	today,
	frequency,
	durationEnabled,
	start,
	end,
	cycle,
	days,
	monthDay,
) {
	if (durationEnabled && (start > today || end < today)) {
		return false;
	}

	switch (frequency) {
		case 'daily':
			return true;
		case 'specific-days':
			return days.includes(today.getDay());
		case 'day-of-month':
			return monthDay === today.getDate();
		case 'cycle':
			const [active, _inactive, current] = cycle;
			return current <= active;
		default:
			return false;
	}
}

export function datesPassedDiff(startDate, endDate) {
	const start = new Date(startDate).setHours(0, 0, 0, 0);
	const end = new Date(endDate).setHours(0, 0, 0, 0);
	const daysDiff = Math.floor((end - start) / 86400000);
	const datesPassed = [];

	for (let i = 1; i <= daysDiff; i++) {
		const currentDate = new Date(startDate);
		currentDate.setHours(0, 0, 0, 0);
		currentDate.setDate(currentDate.getDate() + i);
		datesPassed.push(currentDate);
	}

	return datesPassed;
}

export function addSaveKeyControllerToDialog(dialog, saveBtn) {
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		const shiftPressed = (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
		const controlPressed = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
		const enterPressed = keyval === Gdk.KEY_Return;

		if ((controlPressed || shiftPressed) && enterPressed && saveBtn.sensitive) {
			saveBtn.activate();
		}
	});
	dialog.add_controller(keyController);
}

export function getDayLabel(day, long) {
	const now = GLib.DateTime.new_now_local();
	const date = now.add_days((day - now.get_day_of_week() + 7) % 7);
	const dayLabel = date.format(long ? '%A' : '%a');
	return dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
}

export const HistorySectionSorter = GObject.registerClass(
	{},
	class HistorySectionSorter extends Gtk.Sorter {
		vfunc_compare(a, b) {
			const dtA = new Date(a.obj.taken[0]).setHours(0, 0, 0, 0);
			const dtB = new Date(b.obj.taken[0]).setHours(0, 0, 0, 0);

			return dtA === dtB ? 0 : dtA < dtB ? 1 : -1;
		}
	},
);

export const TodaySectionSorter = GObject.registerClass(
	{},
	class TodaySectionSorter extends Gtk.Sorter {
		vfunc_compare(a, b) {
			let [h1, m1] = a.obj.time;
			let [h2, m2] = b.obj.time;

			const wnA = a.obj.frequency === 'when-needed';
			const wnB = b.obj.frequency === 'when-needed';

			if (wnA) [h1, m1] = [-1, -1];
			if (wnB) [h2, m2] = [-1, -1];

			const hm1 = `${addLeadZero(h1)}${addLeadZero(m1)}`;
			const hm2 = `${addLeadZero(h2)}${addLeadZero(m2)}`;

			return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
		}
	},
);
