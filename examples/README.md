# Portable synthetic examples

Import `assembly.studio.zip` or `piping.studio.zip` through the project menu. These contain generated geometry, no credentials and no private project data.

The assembly example contains 50 synthetic vehicle parts (body, chassis, battery, drive unit, wheel groups and connectors) plus attached labels. It demonstrates seek, play, pause and exact restore. It is an instructional model, not an engineering CAD asset.

The piping example contains 100 logical lines, 1000 physical segments and 500 attached labels, with system/service attributes and published highlight/isolation controls.

To regenerate against a configured local API: `npm run examples:industry`. This creates projects, publishes immutable versions and writes portable exports under ignored `.local/examples/`. The API login configuration is read locally and never printed. The two sample archives can be imported into another configured instance without the original instance.
