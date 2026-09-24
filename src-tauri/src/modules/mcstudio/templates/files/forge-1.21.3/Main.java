package {{package}};

import {{package}}.registry.ModBlocks;
import {{package}}.registry.ModItems;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

@Mod({{main_class}}.MOD_ID)
public class {{main_class}} {
    public static final String MOD_ID = "{{mod_id}}";

    public {{main_class}}(FMLJavaModLoadingContext context) {
        IEventBus modEventBus = context.getModEventBus();
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);
        modEventBus.addListener(ModItems::addCreative);
    }
}
