import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

export const historyHeaderFactory = new Gtk.SignalListItemFactory();
export const historyItemFactory = new Gtk.SignalListItemFactory();

historyHeaderFactory.connect('setup', (factory, listHeaderItem) => {
	const dateLabel = new Gtk.Label({
		halign: Gtk.Align.START,
		margin_bottom: 1,
	});
	listHeaderItem.set_child(dateLabel);
});

historyHeaderFactory.connect('bind', (factory, listHeaderItem) => {
	const item = listHeaderItem.get_item();
	const dateLabel = listHeaderItem.get_child();
	const localTZ = GLib.TimeZone.new_local();
	const dateTime = GLib.DateTime.new_from_iso8601(item.date, null);
	const localDT = dateTime.to_timezone(localTZ);

	let date = localDT.format('%A  •  %x');
	date = date.charAt(0).toUpperCase() + date.slice(1);
	dateLabel.label = date;
});

historyItemFactory.connect('setup', (factory, listItem) => {
	const box = new Gtk.Box({
		css_classes: ['card'],
		height_request: 64,
	});
	const deleteButton = new Gtk.Button({
		css_classes: ['circular'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_start: 12,
		icon_name: 'user-trash-symbolic',
		tooltip_text: _('Delete'),
	});
	box.append(deleteButton);
	const labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 10,
		margin_end: 10,
	});
	box.append(labelsBox);
	const name = new Gtk.Label({
		halign: Gtk.Align.START,
	});
	labelsBox.append(name);
	const dose = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});
	labelsBox.append(dose);
	const takenLabel = new Gtk.Label({
		css_classes: ['taken-label'],
		valign: Gtk.Align.CENTER,
		margin_end: 15,
		visible: true,
		ellipsize: Pango.EllipsizeMode.START,
	});
	box.append(takenLabel);
	listItem.set_child(box);

	deleteButton.connect('clicked', () => {
		const item = listItem.get_item();
		const listView = box.get_parent().get_parent();
		const listStore = listView.get_model().get_model().get_model();

		globalThis.itemRemoved = item;
		const [, position] = listStore.find(item);
		listStore.remove(position);
	});
});

historyItemFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item();
	const box = listItem.get_child();
	const row = box.get_parent();
	const labelsBox = box.get_first_child().get_next_sibling();
	const nameLabel = labelsBox.get_first_child();
	const doseLabel = nameLabel.get_next_sibling();
	const takenLabel = box.get_last_child();

	listItem.set_focusable(false);
	listItem.set_activatable(false);
	row.remove_css_class('activatable');

	let [hours, minutes] = item.info.time;
	let period = '';
	if (clockIs12) {
		period = ' AM';
		if (hours >= 12) period = ' PM';
		if (hours > 12) hours -= 12;
		if (hours === 0) hours = 12;
	}
	const h = String(hours).padStart(2, 0);
	const m = String(minutes).padStart(2, 0);

	nameLabel.label = item.name;
	doseLabel.label = `${item.info.dose} ${item.unit}  •  ${h}∶${m}` + period;

	const localTZ = GLib.TimeZone.new_local();
	const dateTime = GLib.DateTime.new_from_iso8601(item.date, null);
	const localDT = dateTime.to_timezone(localTZ);

	let takenTime = localDT.format('%X').replace(':', '∶');
	let parts = takenTime.split(' ');
	takenTime = parts[0].slice(0, -3);
	// if the time has AM/PM
	if (parts.length > 1) takenTime += ' ' + parts[1];

	if (item.taken === 'yes')
		takenLabel.label = `${takenTime} │ ` +  _("Confirmed");
	else if (item.taken === 'no')
		takenLabel.label = _("Skipped");
	else if (item.taken === 'miss')
		takenLabel.label = _("Missed");

	const colors = [
		'default', 'red', 'orange', 'yellow', 
		'green', 'cyan', 'blue', 'purple'
	];
	colors.forEach(c => box.remove_css_class(c))

	box.add_css_class(item.color);
});
