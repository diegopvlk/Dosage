'use strict';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { addLeadZero } from './utils/helpers.js';
import { amPmStr, clockIs12, timeDot, timeFormat } from './utils/locale.js';

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
			super({
				css_name: 'time-picker',
			});

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
				css_name: 'time-spinbutton',
				orientation: Gtk.Orientation.VERTICAL,
				valign: Gtk.Align.CENTER,
				numeric: true,
				wrap: true,
				adjustment: this.adjH,
			});

			const spinBtnSeparator = new Gtk.Label({
				label: timeDot ? ' . ' : ' ∶ ',
			});

			this.adjM = new Gtk.Adjustment({
				lower: 0,
				upper: 59,
				value: this.minutes,
				step_increment: 5,
			});

			const spinBtnMinutes = new Gtk.SpinButton({
				css_name: 'time-spinbutton',
				orientation: Gtk.Orientation.VERTICAL,
				valign: Gtk.Align.CENTER,
				numeric: true,
				wrap: true,
				adjustment: this.adjM,
			});

			this.buttonsAmPm = new Adw.ToggleGroup({
				margin_start: 8,
				halign: Gtk.Align.CENTER,
				valign: Gtk.Align.CENTER,
				visible: clockIs12,
				orientation: Gtk.Orientation.VERTICAL,
			});

			this.btnAM = new Adw.Toggle({
				label: amPmStr[0],
				name: 'am',
			});

			this.btnPM = new Adw.Toggle({
				label: amPmStr[1],
				name: 'pm',
			});

			hoursMinutesBox.append(spinBtnHours);
			hoursMinutesBox.append(spinBtnSeparator);
			hoursMinutesBox.append(spinBtnMinutes);
			this.append(hoursMinutesBox);
			this.buttonsAmPm.add(this.btnAM);
			this.buttonsAmPm.add(this.btnPM);
			this.buttonsAmPm.active_name = hours12.isPM ? 'pm' : 'am';
			this.append(this.buttonsAmPm);

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

			this.buttonsAmPm.connect('notify::active', () => this.setTime());
		}

		setTime() {
			if (clockIs12) {
				const pmActive = this.buttonsAmPm.active_name === 'pm';
				const hours24 = this.convert12To24(this.adjH.value, pmActive);
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
