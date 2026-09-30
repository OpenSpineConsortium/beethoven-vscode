# Your own research workstation, running while you sleep

*For Wayne State medical students joining an OpenSpineConsortium project.*

You know things no computer scientist on the grid knows. You know why a sacral slope of 9° is
implausible, what a transitional vertebra does to a surgeon's count, which patients get the second
operation. What you may not have is the year it takes to turn that knowledge into a measurement, a
job on 802 CT scans, a figure and a paragraph in a paper. Beethoven for VS Code is built to remove
that year.

## What Wayne State already gave you

The university runs a grid with more than four hundred compute nodes, NVIDIA H200, L40S and A30
GPUs, hundreds of CPU cores you can hold at once, four terabytes of personal storage and twenty
more on the lab's shared volume, and an internet connection from every compute node. Every
student with an AccessID may apply for an account. Almost none do, because the entry fee is a
week of learning SSH, Slurm, containers and shell quoting, and one misstep runs your job on the
login node and gets it killed.

Beethoven pays that fee for you. One wizard: your AccessID, one password and one Authenticator code,
your GitHub and Hugging Face tokens, and a click in the browser that lets Claude work on the grid
as you. From then on the grid never asks you for anything.

## What you get

**A Claude that lives where the data is.** Beethoven starts a Slurm job, on a CPU node or one with a
GPU, that runs Claude Code inside a container in your grid space, with your own subscription. You
talk to it from the Claude Code panel in VS Code, or from a prompt box, or from a phone over ssh if
you like. You say *"in my project folder, measure the bi-iliac width on the ten development cases
and show me the numbers with units"* and it reads the manifest, writes the script, runs it, looks at
the output, fixes what is wrong and answers. Close the laptop. It is still running.

**A conversation that does not forget.** Sessions are named. *"In session `thesis`, what did we
decide about the exclusion list?"* works next week, from a different node.

**Your files, in your editor.** One command opens your grid home in VS Code on the compute node
where your job runs: Explorer, editor, terminal, and a click on a PNG shows the figure. No X
server, no copying files back and forth.

**Two Claudes that work together.** The Claude Code extension on your laptop gets a handful of
tools for the grid. It can plan, and hand the heavy step to the grid worker, and bring the answer
back into the panel. You can say *"check the grid, run the pelvic width demo on ten records, and
tell me whether the sex difference matches the published value"* in one sentence.

**Honesty about limits.** When your subscription window is used up, the worker says so, tells you
when it resets, and waits. It never uses anyone else's account, never types a token on a command
line, and never runs anything heavy on the login node.

**Your science stays yours.** The lab curates the datasets, the Claude containers and the software
in one folder you can read. Everything you build runs in your own grid account, with your own
subscription and your own tokens.

**Claude in your pocket.** Turn on phone access and the Claude app on your phone drives your worker
on the grid: check a job from the bus, ask for the next figure between patients.

## What becomes possible

- A first-year student with an idea on Monday has ten measured cases by Tuesday and a
  pre-registered plan by Friday, because the parts that used to take a month (environment, data
  path, job script, first plot) now take an afternoon.
- A lead runs three projects at once: each has its own worker, its own sessions, its own journal
  written by the worker at the end of every task.
- A literature question becomes a scoping review pipeline: the worker searches PubMed and
  OpenAlex with your criteria, logs every inclusion and exclusion, and drafts the PRISMA table,
  overnight, on a node you are not paying for.
- A model that needs a GPU trains on an H200 while you are in clinic; the loss curve is a PNG in
  your grid folder when you come back.

## What it asks of you

Follow the recipe. Write the question before the number. Freeze the pre-registration. Let the worker
run scripts and jobs, and read what it produced yourself: render the mask, check the spread against
the literature, ask what could make a plausible number wrong. Beethoven makes the machine easy; the
judgement is still the point, and it is yours.

## Getting started

Install the extension, run **Beethoven: Set up my research environment**, and start a worker. The
manual walks through every step with screenshots of what you will see. Your lead can add you to a
project card on the board the same week.
