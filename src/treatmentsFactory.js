'use strict';

import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

export const treatmentsFactory = new Gtk.SignalListItemFactory();

treatmentsFactory.connect('setup', (factory, listItem) => {
	const box = new Gtk.Box({
		css_classes: ['card'],
		height_request: 64,
	});
	const icon = new Gtk.Image({
		margin_start: 18,
		margin_end: 6,
		icon_name: 'pill-symbolic',
	});
	box.append(icon);
	const labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 8,
		margin_end: 12,
	});
	box.append(labelsBox);
	const name = new Gtk.Label({
		halign: Gtk.Align.START,
	});
	labelsBox.append(name);
	const unitAndNotes = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});
	labelsBox.append(unitAndNotes);
	const durationLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		visible: false,
	});
	labelsBox.append(durationLabel);
	const inventoryLabel = new Gtk.Label({
		css_classes: ['inventory-label'],
		valign: Gtk.Align.CENTER,
		margin_end: 5,
		visible: false,
		ellipsize: Pango.EllipsizeMode.START,
	});
	box.append(inventoryLabel);
	const editIcon = new Gtk.Image({
		margin_start: 13,
		margin_end: 18,
		icon_name: 'document-edit-symbolic',
	});
	box.append(editIcon);
	listItem.set_child(box);
});

treatmentsFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item();
	const box = listItem.get_child();
	const row = box.get_parent();
	const icon = box.get_first_child();
	const labelsBox = icon.get_next_sibling();
	const nameLabel = labelsBox.get_first_child();
	const unitLabel = nameLabel.get_next_sibling();
	const durationLabel = unitLabel.get_next_sibling();
	const inventoryLabel = box.get_last_child().get_prev_sibling();

	// activate item with space bar
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			const listView = row.get_parent();
			listView.emit('activate', listItem.position);
		}
	});
	row.add_controller(keyController);

	const inv = item.info.inventory;
	if (inv.enabled && inv.current <= inv.reminder) {
		inventoryLabel.set_visible(true);
		if (inv.current < 0)
			inventoryLabel.label = _("Low stock") + ` │ 0`;
		else
			inventoryLabel.label = _("Low stock") + ` │ ${inv.current}`;
	}

	if (item.info.duration.enabled) {
		durationLabel.set_visible(true);
		const dt = GLib.DateTime.new_from_unix_utc(item.info.duration.end);

		durationLabel.label = _("Until") + ` ${dt.format('%d %b %Y')}`;
	}

	row.remove_css_class('activatable');
	box.add_css_class('activatable');

	nameLabel.label = item.name;
	unitLabel.label = item.unit;

	if (item.info.notes !== '') 
		unitLabel.label += `  •  ${item.info.notes}`;

	const colors = [
		'default', 'red', 'orange', 'yellow',
		'green', 'cyan', 'blue', 'purple'
	];
	colors.forEach(c => box.remove_css_class(c))
	
	box.add_css_class(item.info.color);

	icon.icon_name = item.info.icon;
});
