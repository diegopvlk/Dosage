'use strict';

import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import { addLeadZero, amPmStr, clockIs12, timeDot, timeFormat } from './utils.js';

/**
 * A time picker widget with spin buttons.
 * @param {number} ts - Unix Timestamp.
 * @property {Widget} entry - Gtk.Entry (entry.text for formatted time).
 * @property {number} hours - Current hour.
 * @property {number} minutes - Current minute.
 */
const TimePicker = GObject.registerClass(
	{
		GTypeName: 'TimePicker',
	},
	class TimePicker extends Gtk.Box {
		constructor(ts) {
			super({});

			this.add_css_class('time-picker-box');

			const dTime = GLib.DateTime;
			this.time = ts ? dTime.new_from_unix_local(ts / 1000) : dTime.new_now_local();

			this.hours = this.time.get_hour();
			this.minutes = this.time.get_minute();

			const hours12 = this.convert24To12(this.hours);
			if (clockIs12) this.hours = hours12.hours;

			this.entry = new Gtk.Entry({});
			this.setComponents(hours12);
			this.setTime();
		}

		setComponents(hours12) {
			const hoursMinutesBox = new Gtk.Box({});
			hoursMinutesBox.set_direction(Gtk.TextDirection.LTR);

			this.adjH = new Gtk.Adjustment({
				lower: clockIs12 ? 1 : 0,
				upper: clockIs12 ? 12 : 23,
				value: this.hours,
				step_increment: 1,
			});

			const spinBtnHours = new Gtk.SpinButton({
				css_classes: ['flat'],
				orientation: Gtk.Orientation.VERTICAL,
				valign: Gtk.Align.CENTER,
				numeric: true,
				wrap: true,
				adjustment: this.adjH,
			});

			const spinBtnSeparator = new Gtk.Label({
				label: timeDot ? ' . ' : ' : ',
			});

			this.adjM = new Gtk.Adjustment({
				lower: 0,
				upper: 59,
				value: this.minutes,
				step_increment: 5,
			});

			const spinBtnMinutes = new Gtk.SpinButton({
				css_classes: ['flat'],
				orientation: Gtk.Orientation.VERTICAL,
				valign: Gtk.Align.CENTER,
				numeric: true,
				wrap: true,
				adjustment: this.adjM,
			});

			const buttonsAmPm = new Gtk.Box({
				css_classes: ['linked-custom'],
				orientation: Gtk.Orientation.VERTICAL,
				margin_start: 6,
				halign: Gtk.Align.CENTER,
				valign: Gtk.Align.CENTER,
				visible: clockIs12,
				spacing: 2,
			});

			this.btnAM = new Gtk.ToggleButton({
				css_classes: ['flat'],
				label: amPmStr[0],
				active: !hours12.isPM,
			});

			this.btnPM = new Gtk.ToggleButton({
				css_classes: ['flat'],
				label: amPmStr[1],
				active: hours12.isPM,
				group: this.btnAM,
			});

			hoursMinutesBox.append(spinBtnHours);
			hoursMinutesBox.append(spinBtnSeparator);
			hoursMinutesBox.append(spinBtnMinutes);
			this.append(hoursMinutesBox);
			buttonsAmPm.append(this.btnAM);
			buttonsAmPm.append(this.btnPM);
			this.append(buttonsAmPm);

			spinBtnHours.connect('output', h => {
				h.text = clockIs12 ? String(this.adjH.value) : addLeadZero(this.adjH.value);
				this.setTime();
				return true;
			});

			spinBtnMinutes.connect('output', m => {
				m.text = addLeadZero(this.adjM.value);
				this.setTime();
				return true;
			});

			this.btnAM.connect('clicked', () => this.setTime());
			this.btnPM.connect('clicked', () => this.setTime());
		}

		setTime() {
			if (clockIs12) {
				const hours24 = this.convert12To24(this.adjH.value, this.btnPM.active);
				this.time = GLib.DateTime.new_local(1, 1, 1, hours24, this.adjM.value, 1);
			} else {
				this.time = GLib.DateTime.new_local(1, 1, 1, this.adjH.value, this.adjM.value, 1);
			}

			this.hours = this.time.get_hour();
			this.minutes = this.time.get_minute();

			this.entry.text = this.time.format(timeFormat);
		}

		convert24To12(hours24) {
			const isPM = hours24 >= 12;
			const hours12 = hours24 % 12 || 12;
			return { hours: hours12, isPM };
		}

		convert12To24(hours12, isPM) {
			if (isPM && hours12 < 12) {
				hours12 += 12;
			} else if (!isPM && hours12 === 12) {
				hours12 = 0;
			}
			return hours12;
		}
	},
);

export default TimePicker;
