/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';

import { dateFormat, timeFormat } from './utils.js';
import { DosageApplication } from './main.js';

export const historyHeaderFactory = new Gtk.SignalListItemFactory();
export const historyItemFactory = new Gtk.SignalListItemFactory();

historyHeaderFactory.connect('setup', (factory, listHeader) => {
	listHeader.dateLabel = new Gtk.Label({
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listHeader.set_child(listHeader.dateLabel);
});

historyHeaderFactory.connect('bind', (factory, listHeader) => {
	const item = listHeader.get_item().obj;
	const dateLabel = listHeader.dateLabel;

	const dateTime = GLib.DateTime.new_from_unix_local(item.taken[0] / 1000);
	const formattedDt = dateTime.format(dateFormat);

	dateLabel.label = formattedDt.charAt(0).toUpperCase() + formattedDt.slice(1);
});

historyItemFactory.connect('setup', (factory, listItem) => {
	listItem.box = new Gtk.Box();

	listItem.checkButton = new Gtk.CheckButton({
		css_classes: ['selection-mode'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_start: 11,
		tooltip_text: _('Select to be removed'),
	});

	listItem.checkButton.connect('toggled', btn => {
		const DW = DosageApplication.get_default().activeWindow;
		const pos = listItem.position;

		if (btn.active) {
			DW.histMultiSelect.select_item(pos, false);
		} else {
			DW.histMultiSelect.unselect_item(pos);
		}

		btn.active = listItem.selected;
	});

	listItem.signal = listItem.connect('notify::selected', () => {
		listItem.checkButton.active = listItem.selected;
	});

	listItem.box.append(listItem.checkButton);

	listItem.selectable = false;

	listItem.labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 9,
		margin_end: 10,
	});

	listItem.box.append(listItem.labelsBox);

	listItem.nameLabel = new Gtk.Label({
		css_classes: ['title'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listItem.labelsBox.append(listItem.nameLabel);

	listItem.doseLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.labelsBox.append(listItem.doseLabel);

	listItem.takenBox = new Gtk.Box({
		css_classes: ['badge-box'],
		valign: Gtk.Align.CENTER,
		margin_end: 14,
	});

	listItem.takenLabel = new Gtk.Label({
		css_classes: ['badge-content'],
		valign: Gtk.Align.CENTER,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.takenIcon = new Gtk.Image({
		css_classes: ['badge-content', 'badge-icon'],
	});

	listItem.takenBox.append(listItem.takenLabel);
	listItem.takenBox.append(listItem.takenIcon);
	listItem.box.append(listItem.takenBox);
	listItem.set_child(listItem.box);

	listItem.keyController = new Gtk.EventControllerKey();

	// activate item with space bar
	listItem.keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			const row = listItem.box.parent;
			const listView = row.parent;
			listView.emit('activate', listItem.position);
		}
	});

	listItem.controllerAndSignal = false;
});

historyItemFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item().obj;
	const box = listItem.box;
	const row = box.parent;
	const nameLabel = listItem.nameLabel;
	const doseLabel = listItem.doseLabel;
	const takenLabel = listItem.takenLabel;
	const takenIcon = listItem.takenIcon;

	if (!listItem.controllerAndSignal) {
		row.add_controller(listItem.keyController);

		row.connect('unrealize', () => {
			listItem.disconnect(listItem.signal);
		});

		listItem.item.connect('notify::obj', () => {
			setLabels();
		});

		listItem.controllerAndSignal = true;
	}

	function setLabels() {
		const itemTakenDate = GLib.DateTime.new_from_unix_local(item.taken[0] / 1000);
		const itemTime = GLib.DateTime.new_local(1, 1, 1, item.time[0], item.time[1], 1);
		const time = itemTime.format(timeFormat);
		const timeTaken = itemTakenDate.format(timeFormat);

		nameLabel.label = item.name;
		doseLabel.label = `${item.dose} ${item.unit} • ${time}`;

		const isConfirmed = item.taken[1] === 1 || item.taken[1] === 2 || item.taken[1] === 3;
		takenIcon.visible = isConfirmed;

		switch (item.taken[1]) {
			case 1:
				takenLabel.label = timeTaken;
				takenIcon.icon_name = 'check-confirmed-symbolic';
				break;
			case 2:
				takenLabel.label = _('Auto-confirmed');
				takenIcon.icon_name = 'check-auto-confirmed-symbolic';
				break;
			case 0:
				takenLabel.label = _('Skipped');
				break;
			case -1:
				takenLabel.label = _('Missed');
				break;
			case 3:
				takenLabel.label = _('Confirmed');
				takenIcon.icon_name = 'check-confirmed-symbolic';
		}
	}

	setLabels();

	box.css_classes = ['item-box', item.color];
});
