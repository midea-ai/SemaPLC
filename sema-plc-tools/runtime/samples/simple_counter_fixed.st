PROGRAM counter_program
VAR
    (* Located input variables *)
    start_button AT %IX0.0 : BOOL;
    reset_button AT %IX0.1 : BOOL;
    
    (* Located output variables *)
    counter_value AT %QW0 : INT;
    running_led AT %QX0.0 : BOOL;
END_VAR
VAR_TEMP
    (* Internal variables *)
    counter : INT;
    running : BOOL;
    last_start : BOOL;
    last_reset : BOOL;
END_VAR

(* Initialize variables *)
counter := 0;
running := FALSE;
last_start := FALSE;
last_reset := FALSE;

(* Rising edge detection for start button *)
IF start_button AND NOT last_start THEN
    running := NOT running;
END_IF;
last_start := start_button;

(* Rising edge detection for reset button *)
IF reset_button AND NOT last_reset THEN
    counter := 0;
    running := FALSE;
END_IF;
last_reset := reset_button;

(* Counter logic *)
IF running THEN
    counter := counter + 1;
    IF counter > 9999 THEN
        counter := 0;
    END_IF;
END_IF;

(* Output assignments *)
counter_value := counter;
running_led := running;

END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : counter_program;
END_RESOURCE
END_CONFIGURATION