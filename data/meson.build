pkgdatadir = join_paths(get_option('datadir'), meson.project_name())
datadir = get_option('prefix') / get_option('datadir')

blueprints = custom_target(
	'blueprints',
	input: files(
		'gtk/help-overlay.blp',
		'ui/edit-hist-dialog.blp',
		'ui/med-dialog.blp',
		'ui/one-time-dialog.blp',
		'ui/preferences.blp',
		'ui/refill-dialog.blp',
		'ui/window.blp',
	),
	output: '.',
	command: [
		find_program('blueprint-compiler'),
		'batch-compile',
		'@OUTPUT@',
		'@CURRENT_SOURCE_DIR@',
		'@INPUT@',
	],
)

data_res = gnome.compile_resources(
	'io.github.diegopvlk.Dosage.data',
	'io.github.diegopvlk.Dosage.data.gresource.xml',
	gresource_bundle: true,
	install: true,
	install_dir: pkgdatadir,
	dependencies: blueprints,
)

desktop_file = i18n.merge_file(
	input: 'io.github.diegopvlk.Dosage.desktop.in',
	output: 'io.github.diegopvlk.Dosage.desktop',
	type: 'desktop',
	po_dir: '../po',
	install: true,
	install_dir: join_paths(get_option('datadir'), 'applications'),
)

desktop_utils = find_program('desktop-file-validate', required: false)
if desktop_utils.found()
	test('Validate desktop file', desktop_utils, args: [desktop_file])
endif

appstream_file = i18n.merge_file(
	input: 'io.github.diegopvlk.Dosage.appdata.xml.in',
	output: 'io.github.diegopvlk.Dosage.appdata.xml',
	po_dir: '../po',
	install: true,
	install_dir: join_paths(get_option('datadir'), 'appdata'),
)

appstreamcli = find_program('appstreamcli', required: false)
if appstreamcli.found()
	test(
		'Validate appstream file',
		appstreamcli,
		args: ['validate', '--no-net', '--explain', appstream_file],
	)
endif

install_data(
	'io.github.diegopvlk.Dosage.gschema.xml',
	install_dir: join_paths(get_option('datadir'), 'glib-2.0/schemas'),
)

compile_schemas = find_program('glib-compile-schemas', required: false)
if compile_schemas.found()
	test(
		'Validate schema file',
		compile_schemas,
		args: ['--strict', '--dry-run', meson.current_source_dir()],
	)
endif

subdir('icons')
