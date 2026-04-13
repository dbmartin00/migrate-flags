# Copy FME Flags

Copy your feature flags from one project to another.  Flags with segment dependencies will not completely copy without loading dependent segments first.

[Migrating Segments](https://github.com/dbmartin00/migrate-segment)


## Input Parameters

You must specify envionment variables, e.g.

```
export SPLIT_API_KEY=sat.*****
export SPLIT_WORKSPACE_ID=<source project/workspace id>
export SPLIT_ENVIRONMENT_ID=<source environment id>
export SPLIT_DEST_WORKSPACE_ID=<destination project/workspace id>
export SPLIT_DEST_ENVIRONMENT_ID=<destination environment id>

The source and destination projects and environments are expected to exist; they are not created automatically.

The API key should be Admin account level and have FME Adminstrator binding.

You can get the workspace and environment id from the URL, but it's easier to go to the FME admin settings and copy them directly.


## FUNCTION

**index.js* reads the provided project and environment for feature flags and copies them, with any definition found, to a JSON file in a flags/ subdirectory.

**load.js**

Reads all JSON files in the flags/ directory and creates and defines the flags with the data it finds.


