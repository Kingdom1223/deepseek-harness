process.stdout.write(JSON.stringify({
  argv: process.argv.slice(1),
  electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
}))
