# Whisk Editor for Unity

Makes [Whisk](https://github.com/CookieJarTools/Whisk) one of Unity's script editors.

You don't normally add this by hand: open a Unity project in Whisk and click **Set up Unity**. Whisk copies this package into `Packages/` and makes itself the script editor. Commit the package folder and everyone on the team gets it.

What it does:

- Lists Whisk in **Preferences › External Tools › External Script Editor**.
- Opens scripts in Whisk at the line you double-clicked (a console error, say), in the window you already have open.
- Writes a `.csproj` for each of your assemblies and a `.sln`, which Whisk's C# support reads. Packages from the registry are referenced as compiled DLLs.
- When you debug from Whisk, switches Unity to Debug mode for the session so breakpoints work.
